import { Construct } from 'constructs';
import { App, Chart } from 'cdk8s';
import { Deployment, Ingress, Service, IntOrString, ConfigMap, Secret, HorizontalPodAutoscaler } from './imports/k8s';

class MyChart extends Chart {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    const requests = { cpu: '200m', memory: '128Mi' };
    const limits   = { cpu: '2000m', memory: '256Mi'};
    const probe    = { host: '0.0.0.0', port: '8080', path: '/health'};
    const commonLabels = {
      tier: 'backend',
      domain: 'order',
      version: '1.0.0'
    };

    const label = { app: 'hello-k8s' };
    
    const configMap = new ConfigMap(this, 'service-cfg-map', {
      metadata: {
        labels: Object.assign(label, commonLabels)
      },
      data: {
        app: `aplicacion`,
        iddleTimeout: '3000',
        numThreads: '3',
      }
    });

    const secret = new Secret(this, 'app-secrets', {
      metadata: {
        labels: Object.assign(label, commonLabels)
      },
      data: {
        DATABASE_USERNAME: 'username',
        DATABASE_PASSWORD: 'casa1234',
      }
    })

    const service = new Service(this, 'service', {
      metadata: {
        labels: Object.assign(label, commonLabels)
      },
      spec: {
        type: 'ClusterIp',
        ports: [ { port: 8080, targetPort: IntOrString.fromNumber(8080) } ],
        selector: label
      }
    });


    new Ingress(this, 'ingress', {
      spec: {
        rules: [{
          host: 'mca3-templates-dev.cc.cloudintercorpretail.pe',
          http: {
            paths: [
              {
                path: '/',
                backend: {
                  serviceName: service.name,
                  servicePort: 8080
                },
              }
            ]
          }
        }]
      },
      metadata: {
        labels: Object.assign(label, commonLabels),
        annotations: {
          'cert-manager.io/cluster-issuer': 'letsencrypt-prod',
          'kubernetes.io/ingress.class': 'nginx'
        }
      }
    });

    const deployment = new Deployment(this, 'app-deploy', {
      spec: {
        replicas: 1,
        selector: {
          matchLabels: label
        }, 
        template: {
          metadata: { labels: Object.assign(label, commonLabels) },
          spec: {
            containers: [
              {
                name: 'app-container',
                image: 'gcr.io/pe-intercorpretail-cld-01/micro-service-integ-route',
                ports: [ { containerPort: 8080 } ],
                readinessProbe: { httpGet: probe, initialDelaySeconds: 3, periodSeconds: 15, timeoutSeconds: 5  },
                livenessProbe: { httpGet: probe },
                envFrom: [
                  { configMapRef: { name: configMap.name } },
                  { secretRef: { name: secret.name } }
                ],
                resources : { requests,limits }
              }
            ]
          }
        }
      }
    });
    new HorizontalPodAutoscaler(this, 'app-hpa', {
      metadata: {
        labels: Object.assign(label, commonLabels)
      },
      spec: {
        maxReplicas: 3,
        minReplicas: 1,
        targetCPUUtilizationPercentage: 70,
        scaleTargetRef: {kind: deployment.kind, name: deployment.name}
      }
    });
  }
}

const app = new App();
new MyChart(app, 'app');
app.synth();