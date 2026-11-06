package main

import (
	"sort"
	"strings"
)

var forwardedLabelPrefixes = []string{
	"node.kubernetes.io/",
	"topology.kubernetes.io/",
	"node-role.kubernetes.io/",
	"eks.amazonaws.com/",
	"karpenter.sh/",
	"kubernetes.io/arch",
	"kubernetes.io/os",
	"cloud.google.com/gke-nodepool",
	"kubernetes.azure.com/agentpool",
}

type workloadKey struct{ namespace, kind, name string }

func amountOf(values map[string]string) Amount {
	return Amount{CPUCores: parseQuantity(values["cpu"]), MemoryBytes: parseQuantity(values["memory"])}
}

func add(a, b Amount) Amount {
	return Amount{CPUCores: a.CPUCores + b.CPUCores, MemoryBytes: a.MemoryBytes + b.MemoryBytes}
}

func maxAmount(a, b Amount) Amount {
	out := a
	if b.CPUCores > out.CPUCores {
		out.CPUCores = b.CPUCores
	}
	if b.MemoryBytes > out.MemoryBytes {
		out.MemoryBytes = b.MemoryBytes
	}
	return out
}

func podResources(p kubePod) (Amount, Amount) {
	var requests, limits, initRequests, initLimits Amount
	for _, c := range p.Spec.Containers {
		requests = add(requests, amountOf(c.Resources.Requests))
		limits = add(limits, amountOf(c.Resources.Limits))
	}
	for _, c := range p.Spec.InitContainers {
		initRequests = maxAmount(initRequests, amountOf(c.Resources.Requests))
		initLimits = maxAmount(initLimits, amountOf(c.Resources.Limits))
	}
	return maxAmount(requests, initRequests), maxAmount(limits, initLimits)
}

func isActive(p kubePod) bool {
	return p.Status.Phase != "Succeeded" && p.Status.Phase != "Failed"
}

func nodeRole(labels map[string]string) string {
	for _, key := range []string{"node-role.kubernetes.io/control-plane", "node-role.kubernetes.io/master"} {
		if _, ok := labels[key]; ok {
			return "control-plane"
		}
	}
	return "worker"
}

func forwardedLabels(labels map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range labels {
		for _, prefix := range forwardedLabelPrefixes {
			if strings.HasPrefix(k, prefix) {
				out[k] = v
				break
			}
		}
	}
	return out
}

func controllerOf(meta objectMeta) *ownerRef {
	for i := range meta.OwnerReferences {
		ref := meta.OwnerReferences[i]
		if ref.Controller != nil && *ref.Controller {
			return &ref
		}
	}
	if len(meta.OwnerReferences) > 0 {
		return &meta.OwnerReferences[0]
	}
	return nil
}

func workloadOf(p kubePod, replicaSetOwner map[string]string) workloadKey {
	ref := controllerOf(p.Metadata)
	if ref == nil {
		return workloadKey{p.Metadata.Namespace, "Pod", p.Metadata.Name}
	}
	if ref.Kind == "ReplicaSet" {
		if deployment, ok := replicaSetOwner[p.Metadata.Namespace+"/"+ref.Name]; ok {
			return workloadKey{p.Metadata.Namespace, "Deployment", deployment}
		}
	}
	return workloadKey{p.Metadata.Namespace, ref.Kind, ref.Name}
}

func Aggregate(s Snapshot, metricsAvailable bool) ([]ReportNode, []ReportWorkload) {
	replicaSetOwner := map[string]string{}
	for _, rs := range s.ReplicaSets {
		if ref := controllerOf(rs.Metadata); ref != nil && ref.Kind == "Deployment" {
			replicaSetOwner[rs.Metadata.Namespace+"/"+rs.Metadata.Name] = ref.Name
		}
	}

	desired := map[workloadKey]*int{}
	for _, d := range s.Deployments {
		desired[workloadKey{d.Metadata.Namespace, "Deployment", d.Metadata.Name}] = d.Spec.Replicas
	}
	for _, st := range s.StatefulSets {
		desired[workloadKey{st.Metadata.Namespace, "StatefulSet", st.Metadata.Name}] = st.Spec.Replicas
	}
	for _, ds := range s.DaemonSets {
		desired[workloadKey{ds.Metadata.Namespace, "DaemonSet", ds.Metadata.Name}] = ds.Status.DesiredNumberScheduled
	}

	hpas := map[workloadKey]*ReportHPA{}
	for _, h := range s.HPAs {
		key := workloadKey{h.Metadata.Namespace, h.Spec.ScaleTargetRef.Kind, h.Spec.ScaleTargetRef.Name}
		hpas[key] = &ReportHPA{MinReplicas: h.Spec.MinReplicas, MaxReplicas: h.Spec.MaxReplicas}
	}

	podUsage := map[string]Amount{}
	for _, pm := range s.PodMetrics {
		var total Amount
		for _, c := range pm.Containers {
			total = add(total, amountOf(c.Usage))
		}
		podUsage[pm.Metadata.Namespace+"/"+pm.Metadata.Name] = total
	}

	nodeUsage := map[string]Amount{}
	for _, nm := range s.NodeMetrics {
		nodeUsage[nm.Metadata.Name] = amountOf(nm.Usage)
	}

	nodeTotals := map[string]*ReportNode{}
	nodes := make([]ReportNode, 0, len(s.Nodes))
	for _, n := range s.Nodes {
		instanceType := n.Metadata.Labels["node.kubernetes.io/instance-type"]
		if instanceType == "" {
			instanceType = n.Metadata.Labels["beta.kubernetes.io/instance-type"]
		}
		node := ReportNode{
			Name:         n.Metadata.Name,
			ProviderID:   n.Spec.ProviderID,
			InstanceType: instanceType,
			Role:         nodeRole(n.Metadata.Labels),
			Labels:       forwardedLabels(n.Metadata.Labels),
			Capacity:     amountOf(n.Status.Capacity),
			Allocatable:  amountOf(n.Status.Allocatable),
		}
		if usage, ok := nodeUsage[n.Metadata.Name]; ok && metricsAvailable {
			u := usage
			node.Usage = &u
		}
		nodes = append(nodes, node)
	}
	for i := range nodes {
		nodeTotals[nodes[i].Name] = &nodes[i]
	}

	workloads := map[workloadKey]*ReportWorkload{}
	for _, p := range s.Pods {
		if !isActive(p) {
			continue
		}
		requests, limits := podResources(p)
		if node, ok := nodeTotals[p.Spec.NodeName]; ok {
			node.Requests = add(node.Requests, requests)
			node.Limits = add(node.Limits, limits)
			node.PodCount++
		}
		key := workloadOf(p, replicaSetOwner)
		w, ok := workloads[key]
		if !ok {
			w = &ReportWorkload{Namespace: key.namespace, Kind: key.kind, Name: key.name, DesiredReplicas: desired[key], HPA: hpas[key]}
			workloads[key] = w
		}
		w.PodCount++
		w.Requests = add(w.Requests, requests)
		w.Limits = add(w.Limits, limits)
		if usage, ok := podUsage[p.Metadata.Namespace+"/"+p.Metadata.Name]; ok && metricsAvailable {
			total := usage
			if w.Usage != nil {
				total = add(*w.Usage, usage)
			}
			w.Usage = &total
		}
	}

	out := make([]ReportWorkload, 0, len(workloads))
	for _, w := range workloads {
		out = append(out, *w)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Kind+out[i].Name < out[j].Kind+out[j].Name
	})
	return nodes, out
}
