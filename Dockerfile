FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    TRUST_PROXY_HOPS=0

WORKDIR /app

# Browser bundles are built before packaging. Only PostgreSQL's driver ships.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.js database.js server-secrets.js tobi-service.js tobi-ai.js tobi-public.js tobi-content.js ./
COPY --chown=node:node index.html about.html resources.html interactive.html login.html signup.html dashboard.html privacy.html tobi.html tobi-studio.html ./
COPY --chown=node:node styles.css script.js favicon.svg 1.png 9.png aman-experience.css aman-scene.js aman-scene.bundle.js tobi.js tobi.bundle.js tobi.css tobi-refresh.css ./
COPY --chown=node:node save-world-preview.png ./
COPY --chown=node:node tobi-assets/tobi.svg tobi-assets/tobi-blink.svg tobi-assets/tobi-jump.svg tobi-assets/original-background.jpg ./tobi-assets/
COPY --chown=node:node vendor/three/three.module.min.js vendor/three/LICENSE.txt ./vendor/three/

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
