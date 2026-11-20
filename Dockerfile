FROM nginxinc/nginx-unprivileged:1.27-alpine

ARG VERSION=dev

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/

USER root
RUN echo "${VERSION}" > /usr/share/nginx/html/version.txt
USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
