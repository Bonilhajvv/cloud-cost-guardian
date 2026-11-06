import { AGENT_NAMESPACE } from '../constants/kubernetes.constant';
import { ManifestParams } from '../interfaces/kubernetes.interface';

const q = (value: string): string => JSON.stringify(value);

const RBAC = `apiVersion: v1
kind: Namespace
metadata:
  name: ${AGENT_NAMESPACE}
  labels:
    app.kubernetes.io/name: ccg-agent
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ccg-agent
  namespace: ${AGENT_NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ccg-agent-readonly
rules:
  - apiGroups: [""]
    resources: ["nodes", "pods", "namespaces"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "daemonsets", "replicasets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["nodes", "pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ccg-agent-readonly
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ccg-agent-readonly
subjects:
  - kind: ServiceAccount
    name: ccg-agent
    namespace: ${AGENT_NAMESPACE}`;

export function renderAgentManifest(p: ManifestParams): string {
  return `${RBAC}
---
apiVersion: v1
kind: Secret
metadata:
  name: ccg-agent-credentials
  namespace: ${AGENT_NAMESPACE}
type: Opaque
stringData:
  CCG_AGENT_TOKEN: ${q(p.agentToken)}
  CCG_API_URL: ${q(p.apiUrl)}
  CCG_CLUSTER_ID: ${q(p.clusterId)}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ccg-agent
  namespace: ${AGENT_NAMESPACE}
  labels:
    app.kubernetes.io/name: ccg-agent
    ccg.io/install-method: kubectl
    ccg.io/cluster: ${q(p.clusterName)}
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ccg-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ccg-agent
        ccg.io/install-method: kubectl
    spec:
      serviceAccountName: ccg-agent
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: agent
          image: ${q(p.image)}
          imagePullPolicy: IfNotPresent
          envFrom:
            - secretRef:
                name: ccg-agent-credentials
          env:
            - name: CCG_INSTALL_METHOD
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['ccg.io/install-method']
          ports:
            - name: health
              containerPort: 8080
          livenessProbe:
            httpGet:
              path: /healthz
              port: health
            periodSeconds: 30
          resources:
            requests:
              cpu: 20m
              memory: 32Mi
            limits:
              memory: 128Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
`;
}

export function renderHelmValues(p: ManifestParams): string {
  return `clusterId: ${q(p.clusterId)}
clusterName: ${q(p.clusterName)}
apiUrl: ${q(p.apiUrl)}
agentToken: ${q(p.agentToken)}
image: ${q(p.image)}
`;
}
