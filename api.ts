import { Construct } from 'constructs';
import { App, Chart } from 'cdk8s';
import { Deployment, Ingress, Service, ConfigMap, Secret, HorizontalPodAutoscaler, Probe, ResourceRequirements } from './imports/k8s';
import { readFile } from 'fs';
import { promisify } from 'util';
import * as path from 'path';

interface IngressConfig {
  enabled: boolean;
  host: string;
}

interface HPAConfig {
  enabled: boolean;
  maxReplicas: number;
  minReplicas: number;
  targetCPUUtilizationPercentage: number;
}

interface PortConfig {
  containerPort: number;
  servicePort: number;
}

interface Application {
  name: string,
  image: string,
  labels?: { [key: string]: string },
  hpa: HPAConfig,
  ports: PortConfig,
  ingress: IngressConfig,
  readiness: Probe,
  liveness: Probe,
  resourceLimits: ResourceRequirements,
  resourceRequests: ResourceRequirements,
  config:  { [key: string]: string },
  secret:  { [key: string]: string }
}

class ContainerizedApi extends Chart {
  constructor(scope: Construct, application: Application) {
    super(scope, application.name);
    const { requests, limits } = application.resourceLimits;
    const { name, image, labels, hpa, ingress, ports, readiness, liveness, config, secret } = application;
    
    const label = { app: application.name };
    const allLabels = Object.assign(label, labels);
 
    const configMap = new ConfigMap(this, `configmap`, {
      metadata: {
        labels: allLabels
      },
      data: config
    });

    const appSecret = new Secret(this, `secret`, {
      metadata: {
        labels: allLabels
      },
      data: secret
    })

    const service = new Service(this, `service`, {
      metadata: {
        labels: allLabels
      },
      spec: {
        type: 'ClusterIp',
        ports: [ { port: ports.servicePort, targetPort: ports.containerPort } ],
        selector: label
      }
    });

    if(ingress.enabled) {
      const { host } = ingress;
      new Ingress(this, `ingress`, {
        spec: {
          rules: [{
            host,
            http: {
              paths: [
                {
                  path: '/',
                  backend: {
                    serviceName: service.name,
                    servicePort: ports.servicePort
                  },
                }
              ]
            }
          }]
        },
        metadata: {
          labels: allLabels,
          annotations: {
            'cert-manager.io/cluster-issuer': 'letsencrypt-prod',
            'kubernetes.io/ingress.class': 'nginx'
          }
        }
      });
    }


    const deployment = new Deployment(this, `deployment`, {
      metadata: {
        labels: allLabels
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: label
        }, 
        template: {
          metadata: { labels: allLabels },
          spec: {
            containers: [
              {
                name: `${name}-container`,
                image,
                ports: [ { containerPort: ports.containerPort } ],
                readinessProbe: readiness,
                livenessProbe: liveness,
                envFrom: [
                  { configMapRef: { name: configMap.name } },
                  { secretRef: { name: appSecret.name } }
                ],
                resources : { requests,limits }
              }
            ]
          }
        }
      }
    });

    if(hpa.enabled) {
      const {
        maxReplicas,
        minReplicas,
        targetCPUUtilizationPercentage
      } = hpa;
      new HorizontalPodAutoscaler(this,`hpa`, {
        metadata: {
          labels: allLabels
        },
        spec: {
          maxReplicas,
          minReplicas,
          targetCPUUtilizationPercentage,
          scaleTargetRef: {kind: deployment.kind, name: deployment.name}
        }
      });
    }
  }
}

(async function main() {
  const readFilePromise = promisify(readFile);
  const file = await readFilePromise(path.join(__dirname, 'app.json'), 'utf-8');
  const application = JSON.parse(file);
  const app = new App();
  new ContainerizedApi(app, application);
  app.synth();
})();
