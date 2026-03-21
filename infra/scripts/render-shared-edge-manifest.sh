#!/bin/sh

set -eu

env_file="${1:-.env.server}"

if [ ! -f "$env_file" ]; then
  echo "Файл $env_file не найден" >&2
  exit 1
fi

env_file_path="$env_file"
case "$env_file_path" in
  */*) ;;
  *) env_file_path="./$env_file_path" ;;
esac

set -a
. "$env_file_path"
set +a

require_env() {
  name="$1"
  eval "value=\${$name:-}"

  if [ -z "$value" ]; then
    echo "Переменная $name обязательна для render shared edge manifest" >&2
    exit 1
  fi
}

require_env AERO_SHARED_EDGE_HOST_IP
require_env AERO_WEB_HOST_PORT
require_env AERO_GATEWAY_HOST_PORT
require_env AERO_MEDIA_HOST_PORT
require_env AERO_EDGE_DOMAIN
require_env AERO_MEDIA_EDGE_DOMAIN

case "$AERO_MEDIA_EDGE_DOMAIN" in
  *."$AERO_EDGE_DOMAIN")
    echo "AERO_MEDIA_EDGE_DOMAIN не должен быть nested host под AERO_EDGE_DOMAIN: ожидается sibling-host вида media.<zone-domain>" >&2
    exit 1
    ;;
esac

namespace="${AERO_K8S_EDGE_NAMESPACE:-aerochat-edge}"
ingress_class="${AERO_K8S_INGRESS_CLASS:-traefik}"
cluster_issuer="${AERO_K8S_CLUSTER_ISSUER:-letsencrypt-prod}"

edge_tls_secret="$(printf '%s' "$AERO_EDGE_DOMAIN" | tr '.' '-')-tls"
media_tls_secret="$(printf '%s' "$AERO_MEDIA_EDGE_DOMAIN" | tr '.' '-')-tls"

cat <<EOF
# Сгенерировано из $env_file.
# Перед apply при необходимости переопредели:
# - AERO_K8S_EDGE_NAMESPACE
# - AERO_K8S_INGRESS_CLASS
# - AERO_K8S_CLUSTER_ISSUER
apiVersion: v1
kind: Namespace
metadata:
  name: $namespace
---
apiVersion: v1
kind: Service
metadata:
  name: aerochat-web
  namespace: $namespace
spec:
  ports:
    - name: http
      port: 80
      protocol: TCP
      targetPort: $AERO_WEB_HOST_PORT
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aerochat-web-external
  namespace: $namespace
  labels:
    kubernetes.io/service-name: aerochat-web
addressType: IPv4
ports:
  - name: http
    protocol: TCP
    port: $AERO_WEB_HOST_PORT
endpoints:
  - addresses:
      - $AERO_SHARED_EDGE_HOST_IP
    conditions:
      ready: true
---
apiVersion: v1
kind: Service
metadata:
  name: aerochat-media
  namespace: $namespace
spec:
  ports:
    - name: http
      port: 80
      protocol: TCP
      targetPort: $AERO_MEDIA_HOST_PORT
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aerochat-media-external
  namespace: $namespace
  labels:
    kubernetes.io/service-name: aerochat-media
addressType: IPv4
ports:
  - name: http
    protocol: TCP
    port: $AERO_MEDIA_HOST_PORT
endpoints:
  - addresses:
      - $AERO_SHARED_EDGE_HOST_IP
    conditions:
      ready: true
---
apiVersion: v1
kind: Service
metadata:
  name: aerochat-gateway
  namespace: $namespace
spec:
  ports:
    - name: http
      port: 80
      protocol: TCP
      targetPort: $AERO_GATEWAY_HOST_PORT
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: aerochat-gateway-external
  namespace: $namespace
  labels:
    kubernetes.io/service-name: aerochat-gateway
addressType: IPv4
ports:
  - name: http
    protocol: TCP
    port: $AERO_GATEWAY_HOST_PORT
endpoints:
  - addresses:
      - $AERO_SHARED_EDGE_HOST_IP
    conditions:
      ready: true
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: aerochat-strip-api-prefix
  namespace: $namespace
spec:
  stripPrefix:
    prefixes:
      - /api
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aerochat-web
  namespace: $namespace
  annotations:
    cert-manager.io/cluster-issuer: $cluster_issuer
spec:
  ingressClassName: $ingress_class
  tls:
    - hosts:
        - $AERO_EDGE_DOMAIN
      secretName: $edge_tls_secret
  rules:
    - host: $AERO_EDGE_DOMAIN
      http:
        paths:
          - path: /healthz
            pathType: Exact
            backend:
              service:
                name: aerochat-gateway
                port:
                  name: http
          - path: /readyz
            pathType: Exact
            backend:
              service:
                name: aerochat-gateway
                port:
                  name: http
          - path: /
            pathType: Prefix
            backend:
              service:
                name: aerochat-web
                port:
                  name: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aerochat-media
  namespace: $namespace
  annotations:
    cert-manager.io/cluster-issuer: $cluster_issuer
spec:
  ingressClassName: $ingress_class
  tls:
    - hosts:
        - $AERO_MEDIA_EDGE_DOMAIN
      secretName: $media_tls_secret
  rules:
    - host: $AERO_MEDIA_EDGE_DOMAIN
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: aerochat-media
                port:
                  name: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aerochat-api
  namespace: $namespace
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: ${namespace}-aerochat-strip-api-prefix@kubernetescrd
spec:
  ingressClassName: $ingress_class
  tls:
    - hosts:
        - $AERO_EDGE_DOMAIN
      secretName: $edge_tls_secret
  rules:
    - host: $AERO_EDGE_DOMAIN
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: aerochat-gateway
                port:
                  name: http
EOF
