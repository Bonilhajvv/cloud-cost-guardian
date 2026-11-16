package main

import "testing"

func ptr[T any](v T) *T { return &v }

func TestAggregate(t *testing.T) {
	var s Snapshot
	worker := kubeNode{}
	worker.Metadata.Name = "worker-1"
	worker.Metadata.Labels = map[string]string{"node.kubernetes.io/instance-type": "t3.medium", "team": "secret"}
	worker.Spec.ProviderID = "aws:///us-east-1a/i-0ea49e6ecda54b39d"
	worker.Status.Capacity = map[string]string{"cpu": "2", "memory": "3977560Ki"}
	worker.Status.Allocatable = map[string]string{"cpu": "1930m", "memory": "3460Mi"}
	worker.Status.Addresses = []nodeAddress{{Type: "Hostname", Address: "worker-1"}, {Type: "InternalIP", Address: "10.0.11.58"}}
	master := kubeNode{}
	master.Metadata.Name = "master-1"
	master.Metadata.Labels = map[string]string{"node-role.kubernetes.io/control-plane": ""}
	s.Nodes = []kubeNode{worker, master}

	rs := kubeScalable{}
	rs.Metadata = objectMeta{Name: "api-7d9f", Namespace: "prod", OwnerReferences: []ownerRef{{Kind: "Deployment", Name: "api", Controller: ptr(true)}}}
	s.ReplicaSets = []kubeScalable{rs}
	dep := kubeScalable{}
	dep.Metadata = objectMeta{Name: "api", Namespace: "prod"}
	dep.Spec.Replicas = ptr(2)
	s.Deployments = []kubeScalable{dep}

	newPod := func(name, phase string, memReq string) kubePod {
		p := kubePod{}
		p.Metadata = objectMeta{Name: name, Namespace: "prod", OwnerReferences: []ownerRef{{Kind: "ReplicaSet", Name: "api-7d9f", Controller: ptr(true)}}}
		p.Spec.NodeName = "worker-1"
		c := container{Name: "app"}
		c.Resources.Requests = map[string]string{"cpu": "250m", "memory": memReq}
		c.Resources.Limits = map[string]string{"memory": "1Gi"}
		p.Spec.Containers = []container{c}
		p.Status.Phase = phase
		return p
	}
	s.Pods = []kubePod{newPod("api-1", "Running", "512Mi"), newPod("api-2", "Running", "512Mi"), newPod("old", "Succeeded", "4Gi")}

	nm := nodeMetrics{Usage: map[string]string{"cpu": "123456789n", "memory": "1500Mi"}}
	nm.Metadata.Name = "worker-1"
	s.NodeMetrics = []nodeMetrics{nm}
	pm := podMetrics{}
	pm.Metadata = objectMeta{Name: "api-1", Namespace: "prod"}
	pm.Containers = append(pm.Containers, struct {
		Name  string            `json:"name"`
		Usage map[string]string `json:"usage"`
	}{Name: "app", Usage: map[string]string{"cpu": "50m", "memory": "300Mi"}})
	s.PodMetrics = []podMetrics{pm}

	nodes, workloads := Aggregate(s, true)

	if len(nodes) != 2 {
		t.Fatalf("nodes = %d", len(nodes))
	}
	w1 := nodes[0]
	if w1.Role != "worker" || nodes[1].Role != "control-plane" {
		t.Errorf("roles = %s, %s", w1.Role, nodes[1].Role)
	}
	if w1.InternalIP != "10.0.11.58" || nodes[1].InternalIP != "" {
		t.Errorf("internalIP = %q, %q", w1.InternalIP, nodes[1].InternalIP)
	}
	if w1.InstanceType != "t3.medium" || w1.PodCount != 2 {
		t.Errorf("instanceType=%s podCount=%d", w1.InstanceType, w1.PodCount)
	}
	if _, leaked := w1.Labels["team"]; leaked {
		t.Error("custom labels must not be forwarded")
	}
	if w1.Requests.MemoryBytes != 1024*1024*1024 || w1.Requests.CPUCores != 0.5 {
		t.Errorf("requests = %+v", w1.Requests)
	}
	if w1.Usage == nil || w1.Usage.MemoryBytes != 1500*1024*1024 {
		t.Errorf("usage = %+v", w1.Usage)
	}
	if len(workloads) != 1 || workloads[0].Kind != "Deployment" || workloads[0].Name != "api" {
		t.Fatalf("workloads = %+v", workloads)
	}
	if workloads[0].PodCount != 2 || *workloads[0].DesiredReplicas != 2 || workloads[0].Usage.MemoryBytes != 300*1024*1024 {
		t.Errorf("workload = %+v", workloads[0])
	}
}

func TestAggregateWithoutMetrics(t *testing.T) {
	var s Snapshot
	n := kubeNode{}
	n.Metadata.Name = "n1"
	s.Nodes = []kubeNode{n}
	nm := nodeMetrics{Usage: map[string]string{"memory": "1Gi"}}
	nm.Metadata.Name = "n1"
	s.NodeMetrics = []nodeMetrics{nm}
	nodes, _ := Aggregate(s, false)
	if nodes[0].Usage != nil {
		t.Error("usage must be nil without metrics-server")
	}
}

func TestFilesystemOf(t *testing.T) {
	var s kubeletSummary
	if _, ok := filesystemOf(s); ok {
		t.Fatal("summary without fs must be ignored")
	}
	s.Node.Fs = &struct {
		UsedBytes     *float64 `json:"usedBytes"`
		CapacityBytes *float64 `json:"capacityBytes"`
	}{UsedBytes: ptr(9e9), CapacityBytes: ptr(0.0)}
	if _, ok := filesystemOf(s); ok {
		t.Fatal("zero capacity must be ignored")
	}
	s.Node.Fs.CapacityBytes = ptr(2e10)
	if fs, ok := filesystemOf(s); !ok || fs.UsedBytes != 9e9 || fs.CapacityBytes != 2e10 {
		t.Fatalf("unexpected filesystem %+v %v", fs, ok)
	}
}

func TestAggregateFilesystem(t *testing.T) {
	var s Snapshot
	n := kubeNode{}
	n.Metadata.Name = "worker-1"
	other := kubeNode{}
	other.Metadata.Name = "worker-2"
	s.Nodes = []kubeNode{n, other}
	s.NodeFS = map[string]Filesystem{"worker-1": {UsedBytes: 1, CapacityBytes: 4}}
	nodes, _ := Aggregate(s, false)
	if nodes[0].Filesystem == nil || nodes[0].Filesystem.CapacityBytes != 4 {
		t.Fatalf("worker-1 filesystem missing: %+v", nodes[0].Filesystem)
	}
	if nodes[1].Filesystem != nil {
		t.Fatal("worker-2 must have no filesystem")
	}
}
