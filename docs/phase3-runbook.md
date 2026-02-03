# Phase 3 Runbook — EKS Deployment

Run these commands from your Mac in the `aware/` repo directory.

## Prerequisites

```bash
# Check you have these installed
aws --version
terraform --version
kubectl version --client
helm version

# If missing kubectl:
brew install kubectl

# If missing helm:
brew install helm
```

## Step 1: Terraform Apply

```bash
cd infra/

# Initialize (if first time or new providers added)
terraform init

# Preview what will be created
terraform plan

# Apply — creates EKS cluster + node group (~10-15 min)
terraform apply
```

## Step 2: Configure kubectl

```bash
# Get the kubeconfig command from Terraform output
terraform output -raw eks_kubeconfig_command

# Run it (should look like):
aws eks update-kubeconfig --region us-east-1 --name aware-production

# Verify
kubectl get nodes
# Should show 1 node (t3.small spot) in Ready state
```

## Step 3: Create Tenants Namespace

```bash
kubectl create namespace tenants
```

## Step 4: Install Nginx Ingress Controller

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"=nlb \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-scheme"=internet-facing

# Wait for the NLB to get an external address (~2-3 min)
kubectl get svc -n ingress-nginx ingress-nginx-controller -w

# Once EXTERNAL-IP shows a hostname, copy it — you'll need it for DNS
```

## Step 5: Install cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true

# Wait for pods to be ready
kubectl get pods -n cert-manager -w
```

## Step 6: Create Let's Encrypt ClusterIssuer

```bash
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: myles@wareit.ai
    privateKeySecretRef:
      name: letsencrypt-account-key
    solvers:
    - http01:
        ingress:
          class: nginx
EOF

# Verify it's ready
kubectl get clusterissuer letsencrypt
# Should show Ready: True
```

## Step 7: Update DNS

The `*.wareit.ai` wildcard record needs to point at the NLB created by the ingress controller.

```bash
# Get the NLB hostname
kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

Then update `infra/dns.tf` — change the gateway wildcard from ALB alias to NLB:

**Option A: Manual in Route 53 console**
- Go to Route 53 → wareit.ai hosted zone
- Edit the `*.wareit.ai` record
- Change alias target to the NLB hostname

**Option B: Add to Terraform** (preferred — I can do this part)
- We'll need the NLB hostname or ARN to create the alias record

## Step 8: Verify

```bash
# Create a test tenant pod to verify everything works
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: test-gateway
  namespace: tenants
  labels:
    app: test
spec:
  containers:
  - name: nginx
    image: nginx:alpine
    ports:
    - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: test-gateway
  namespace: tenants
spec:
  selector:
    app: test
  ports:
  - port: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: test-gateway
  namespace: tenants
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - test.wareit.ai
    secretName: test-tls
  rules:
  - host: test.wareit.ai
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: test-gateway
            port:
              number: 80
EOF

# Wait a minute for cert to issue, then test
curl https://test.wareit.ai

# Clean up test
kubectl delete pod,svc,ingress test-gateway -n tenants
```

## Step 9: Push Gateway Image to ECR

```bash
# From the aware/ repo root
cd ..

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $(cd infra && terraform output -raw ecr_gateway_repository_url | cut -d/ -f1)

# Build and push (from ARM Mac, target amd64)
docker build --platform linux/amd64 -t aware-gateway -f Dockerfile.gateway .
docker tag aware-gateway:latest $(cd infra && terraform output -raw ecr_gateway_repository_url):latest
docker push $(cd infra && terraform output -raw ecr_gateway_repository_url):latest
```

## Done

After this, the API provisioner can create tenant pods via the Kubernetes API.
The API ECS task needs these env vars to connect to EKS:
- `EKS_CLUSTER_NAME` — from `terraform output -raw eks_cluster_name`
- `AWS_REGION` — `us-east-1`
- `GATEWAY_IMAGE` — from `terraform output -raw ecr_gateway_repository_url` + `:latest`
- `GATEWAY_BASE_DOMAIN` — `wareit.ai`
