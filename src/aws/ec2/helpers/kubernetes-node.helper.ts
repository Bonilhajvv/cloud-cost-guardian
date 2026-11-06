import {
  EKS_CLUSTER_TAGS,
  K8S_CLUSTER_TAG_PREFIX,
  K8S_CONTROL_PLANE_NAME_PATTERN,
  K8S_CONTROL_PLANE_TAGS,
  K8S_NAME_PATTERN,
  K8S_NODE_TAGS,
} from '../constants/kubernetes.constant';
import { Ec2InstanceDetails } from '../interfaces/ec2-instance.interface';
import { KubernetesNodeInfo } from '../interfaces/kubernetes-node.interface';

export function detectKubernetesNode(instance: Pick<Ec2InstanceDetails, 'name' | 'tags'>): KubernetesNodeInfo | null {
  const tags = instance.tags;
  const keys = Object.keys(tags);
  const signals: string[] = [];
  let cluster: string | null = null;
  let managedBy: KubernetesNodeInfo['managedBy'] = 'SELF_MANAGED';

  const clusterTag = keys.find((k) => k.startsWith(K8S_CLUSTER_TAG_PREFIX));
  if (clusterTag) {
    cluster = clusterTag.slice(K8S_CLUSTER_TAG_PREFIX.length) || null;
    signals.push(`tag ${clusterTag}`);
  }
  const eksTag = EKS_CLUSTER_TAGS.find((k) => tags[k]);
  if (eksTag) {
    cluster = tags[eksTag];
    managedBy = 'EKS';
    signals.push(`tag ${eksTag}`);
  }
  const nodeTag = K8S_NODE_TAGS.find((k) => k in tags);
  if (nodeTag) signals.push(`tag ${nodeTag}`);
  const controlPlaneTag = K8S_CONTROL_PLANE_TAGS.find((k) => k in tags);
  if (controlPlaneTag) signals.push(`tag ${controlPlaneTag}`);
  if (instance.name && K8S_NAME_PATTERN.test(instance.name)) signals.push(`name ${instance.name}`);

  if (signals.length === 0) return null;

  const isControlPlane =
    managedBy !== 'EKS' &&
    (!!controlPlaneTag || (!!instance.name && K8S_CONTROL_PLANE_NAME_PATTERN.test(instance.name)));
  return { role: isControlPlane ? 'CONTROL_PLANE' : 'WORKER', cluster, managedBy, signals };
}
