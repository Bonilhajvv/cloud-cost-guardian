package main

type Amount struct {
	CPUCores    float64 `json:"cpuCores"`
	MemoryBytes float64 `json:"memoryBytes"`
}

type ReportNode struct {
	Name         string            `json:"name"`
	ProviderID   string            `json:"providerId,omitempty"`
	InstanceType string            `json:"instanceType,omitempty"`
	Role         string            `json:"role"`
	Labels       map[string]string `json:"labels"`
	Capacity     Amount            `json:"capacity"`
	Allocatable  Amount            `json:"allocatable"`
	Requests     Amount            `json:"requests"`
	Limits       Amount            `json:"limits"`
	Usage        *Amount           `json:"usage,omitempty"`
	PodCount     int               `json:"podCount"`
}

type ReportHPA struct {
	MinReplicas *int `json:"minReplicas"`
	MaxReplicas int  `json:"maxReplicas"`
}

type ReportWorkload struct {
	Namespace       string     `json:"namespace"`
	Kind            string     `json:"kind"`
	Name            string     `json:"name"`
	DesiredReplicas *int       `json:"desiredReplicas"`
	PodCount        int        `json:"podCount"`
	Requests        Amount     `json:"requests"`
	Limits          Amount     `json:"limits"`
	Usage           *Amount    `json:"usage,omitempty"`
	HPA             *ReportHPA `json:"hpa,omitempty"`
}

type Report struct {
	AgentVersion           string           `json:"agentVersion"`
	InstallMethod          string           `json:"installMethod"`
	KubernetesVersion      string           `json:"kubernetesVersion"`
	MetricsServerAvailable bool             `json:"metricsServerAvailable"`
	CollectedAt            string           `json:"collectedAt"`
	Nodes                  []ReportNode     `json:"nodes"`
	Workloads              []ReportWorkload `json:"workloads"`
}

type ownerRef struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Controller *bool  `json:"controller"`
}

type objectMeta struct {
	Name            string            `json:"name"`
	Namespace       string            `json:"namespace"`
	Labels          map[string]string `json:"labels"`
	OwnerReferences []ownerRef        `json:"ownerReferences"`
}

type kubeNode struct {
	Metadata objectMeta `json:"metadata"`
	Spec     struct {
		ProviderID string `json:"providerID"`
	} `json:"spec"`
	Status struct {
		Capacity    map[string]string `json:"capacity"`
		Allocatable map[string]string `json:"allocatable"`
	} `json:"status"`
}

type container struct {
	Name      string `json:"name"`
	Resources struct {
		Requests map[string]string `json:"requests"`
		Limits   map[string]string `json:"limits"`
	} `json:"resources"`
}

type kubePod struct {
	Metadata objectMeta `json:"metadata"`
	Spec     struct {
		NodeName       string      `json:"nodeName"`
		Containers     []container `json:"containers"`
		InitContainers []container `json:"initContainers"`
	} `json:"spec"`
	Status struct {
		Phase string `json:"phase"`
	} `json:"status"`
}

type kubeScalable struct {
	Metadata objectMeta `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status struct {
		DesiredNumberScheduled *int `json:"desiredNumberScheduled"`
	} `json:"status"`
}

type kubeHPA struct {
	Metadata objectMeta `json:"metadata"`
	Spec     struct {
		ScaleTargetRef struct {
			Kind string `json:"kind"`
			Name string `json:"name"`
		} `json:"scaleTargetRef"`
		MinReplicas *int `json:"minReplicas"`
		MaxReplicas int  `json:"maxReplicas"`
	} `json:"spec"`
}

type nodeMetrics struct {
	Metadata objectMeta        `json:"metadata"`
	Usage    map[string]string `json:"usage"`
}

type podMetrics struct {
	Metadata   objectMeta `json:"metadata"`
	Containers []struct {
		Name  string            `json:"name"`
		Usage map[string]string `json:"usage"`
	} `json:"containers"`
}

type list[T any] struct {
	Items []T `json:"items"`
}

type Snapshot struct {
	Nodes        []kubeNode
	Pods         []kubePod
	ReplicaSets  []kubeScalable
	Deployments  []kubeScalable
	StatefulSets []kubeScalable
	DaemonSets   []kubeScalable
	HPAs         []kubeHPA
	NodeMetrics  []nodeMetrics
	PodMetrics   []podMetrics
}
