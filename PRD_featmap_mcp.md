# PRD: Featmap MCP Server

**Repositorio base:** `https://github.com/danceballos/featmap` (branch `feat/claude-integration`)  
**Entregable:** Nuevo servicio Docker `featmap-mcp` que expone un MCP server conectado a la API REST de featmap.  
**Stack:** Node.js + TypeScript, usando el [MCP SDK oficial de Anthropic](https://github.com/modelcontextprotocol/typescript-sdk).

---

## Contexto

Featmap corre en una VM de Google Cloud con Docker Compose. El fork `feat/claude-integration` ya agrega una API REST en Go (`/v1/claude/...`) con autenticación por API key (SHA-256, header `X-API-Key`). El MCP server consumirá esa API — no tocará la base de datos directamente.

La API REST existente expone:
- `GET /v1/claude/projects` — lista proyectos
- `GET /v1/claude/projects/{id}/features` — features con contexto completo (milestone, workflow, prioridad, comentarios)
- `POST /v1/claude/features/{id}/status` — actualizar status (`OPEN`, `IN_PROGRESS`, `CLOSED`)
- `POST /v1/claude/features/{id}/annotations` — actualizar annotations

El service layer de Go ya implementa `CreateFeatureWithID`, `MoveFeature`, `UpdateFeatureDescription`, `CreateFeatureCommentWithID` — se necesitan endpoints REST adicionales para exponerlos.

---

## Objetivos

El MCP server cubre dos workflows:

**Dev-time (Cursor / cualquier agente):** El dev instala el MCP localmente, apunta al servidor de producción, y ejecuta el ciclo completo de desarrollo sin salir del editor.

**Product/planning time (Claude.ai):** El PM gestiona el backlog desde Claude.ai — crea features, edita descripciones, mueve features entre milestones, deja comentarios.

---

## Arquitectura

```
VM Google Cloud
├── contenedor: postgres
├── contenedor: featmap          ← API REST en :5000 (Go)
└── contenedor: featmap-mcp      ← MCP server en :3000 (Node/TS)
    └── consume /v1/claude/* de featmap via red interna Docker
```

El MCP server se conecta a featmap por la red interna de Docker (`http://featmap:5000`), nunca expuesto directamente a internet.

### Transporte MCP

El servidor expone **HTTP con SSE** (Server-Sent Events) — el transporte que requiere Claude.ai para conectarse a MCPs remotos. Cursor también lo soporta.

---

## Parte 1: Nuevos endpoints en featmap (Go)

Antes de construir el MCP, hay que agregar 4 endpoints al archivo `claude-api.go` del fork. Todos requieren `RequireAPIKey()`.

| Método | Ruta | Acción | Service method existente |
|--------|------|--------|--------------------------|
| `POST` | `/v1/claude/projects/{PROJECT_ID}/features` | Crear feature | `CreateFeatureWithID` |
| `PUT` | `/v1/claude/features/{FEATURE_ID}/description` | Editar descripción | `UpdateFeatureDescription` |
| `POST` | `/v1/claude/features/{FEATURE_ID}/move` | Mover feature | `MoveFeature` |
| `POST` | `/v1/claude/features/{FEATURE_ID}/comments` | Agregar comentario | `CreateFeatureCommentWithID` |

Bodies de request:

```json
// POST /features — crear
{ "subWorkflowId": "uuid", "milestoneId": "uuid", "title": "string" }

// PUT /features/{id}/description
{ "description": "string" }

// POST /features/{id}/move
{ "toMilestoneId": "uuid", "toSubWorkflowId": "uuid", "index": 0 }

// POST /features/{id}/comments
{ "post": "string" }
```

---

## Parte 2: MCP Server (Node/TypeScript)

### Estructura de archivos

```
featmap-mcp/
├── src/
│   ├── index.ts          ← entry point, configura el server MCP
│   ├── client.ts         ← wrapper HTTP para la API REST de featmap
│   └── tools/
│       ├── dev.ts        ← tools para dev-time
│       └── planning.ts   ← tools para product/planning
├── Dockerfile
├── package.json
└── .env.example
```

### Variables de entorno

```env
FEATMAP_BASE_URL=http://featmap:5000   # URL interna Docker
FEATMAP_API_KEY=fm_xxxxx               # API key del workspace
MCP_PORT=3000
```

### Tools MCP — Dev-time

Estos tools están pensados para agentes en Cursor ejecutando un ciclo de desarrollo.

---

**`list_projects`**  
Lista todos los proyectos del workspace.  
Sin parámetros. Devuelve array de `{ id, title, description }`.

---

**`get_features`**  
Devuelve todas las features de un proyecto con contexto completo: milestone, workflow, subworkflow, comentarios y prioridad calculada.

Parámetros:
```typescript
{ projectId: string }
```

La respuesta incluye el campo `instructions` de la API — el agente debe leerlo y seguirlo antes de procesar features.

---

**`update_feature_status`**  
Cambia el status de una feature.

Parámetros:
```typescript
{ featureId: string, status: "OPEN" | "IN_PROGRESS" | "CLOSED" }
```

---

**`update_feature_annotations`**  
Escribe notas técnicas en el campo annotations de una feature (decisiones de implementación, links a PRs, etc.).

Parámetros:
```typescript
{ featureId: string, annotations: string }
```

---

### Tools MCP — Product/Planning

Estos tools están pensados para el PM operando desde Claude.ai.

---

**`create_feature`**  
Crea una nueva feature en el story map.

Parámetros:
```typescript
{
  projectId: string,
  title: string,
  subWorkflowId: string,
  milestoneId: string
}
```

---

**`update_feature_description`**  
Edita la descripción de una feature existente.

Parámetros:
```typescript
{ featureId: string, description: string }
```

---

**`move_feature`**  
Mueve una feature a otro milestone o subworkflow.

Parámetros:
```typescript
{
  featureId: string,
  toMilestoneId: string,
  toSubWorkflowId: string,
  index?: number   // posición dentro del slot, default 0
}
```

---

**`add_comment`**  
Agrega un comentario a una feature. Útil para que el PM deje contexto que el dev verá desde su agente.

Parámetros:
```typescript
{ featureId: string, post: string }
```

---

### Implementación de `client.ts`

```typescript
export class FeatmapClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.FEATMAP_BASE_URL!;
    this.apiKey  = process.env.FEATMAP_API_KEY!;
  }

  private async request(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.baseUrl}/v1/claude${path}`, {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Featmap API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  listProjects()                          { return this.request("GET", "/projects"); }
  getFeatures(projectId: string)          { return this.request("GET", `/projects/${projectId}/features`); }
  updateStatus(id: string, status: string){ return this.request("POST", `/features/${id}/status`, { status }); }
  updateAnnotations(id: string, annotations: string) { return this.request("POST", `/features/${id}/annotations`, { annotations }); }
  createFeature(projectId: string, payload: object) { return this.request("POST", `/projects/${projectId}/features`, payload); }
  updateDescription(id: string, description: string){ return this.request("PUT", `/features/${id}/description`, { description }); }
  moveFeature(id: string, payload: object){ return this.request("POST", `/features/${id}/move`, payload); }
  addComment(id: string, post: string)    { return this.request("POST", `/features/${id}/comments`, { post }); }
}
```

---

## Parte 3: Docker

### `featmap-mcp/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Cambios en `docker-compose.yml`

```yaml
  featmap-mcp:
    build:
      context: ./featmap-mcp
      dockerfile: Dockerfile
    restart: always
    ports:
      - "3000:3000"
    environment:
      FEATMAP_BASE_URL: http://featmap:5000
      FEATMAP_API_KEY: ${FEATMAP_MCP_API_KEY}
      MCP_PORT: 3000
    depends_on:
      - featmap
```

`FEATMAP_MCP_API_KEY` es una API key generada desde featmap para este servicio — se agrega al `.env` del servidor.

---

## Parte 4: Conexión desde Claude.ai y Cursor

### Claude.ai

En Settings → Integrations → Add MCP Server:

```
URL: http://<IP-VM-GCP>:3000/sse
```

El puerto 3000 debe estar abierto en el firewall de GCP para la IP del usuario (o restringido por token).

### Cursor

En `.cursor/mcp.json` del proyecto:

```json
{
  "mcpServers": {
    "featmap": {
      "url": "http://<IP-VM-GCP>:3000/sse"
    }
  }
}
```

---

## Seguridad

El MCP server hereda la autenticación de la API REST: cada request usa la API key configurada en `FEATMAP_MCP_API_KEY`. El servidor MCP no expone credentials al cliente — actúa como proxy autenticado.

Para producción, se recomienda poner el puerto 3000 detrás de un proxy con TLS (nginx o Cloud Load Balancer) y restringir acceso por IP en el firewall de GCP.

---

## Secuencia de construcción recomendada para Cursor

1. Hacer cherry-pick de los commits de edbyford en `feat/claude-integration`
2. Agregar los 4 endpoints nuevos en `claude-api.go`
3. Crear el directorio `featmap-mcp/` con la estructura descrita
4. Implementar `client.ts` e `index.ts` con el MCP SDK
5. Actualizar `docker-compose.yml`
6. Probar localmente con `docker-compose up --build`
7. Deploy en VM GCP

---

## Out of scope

- UI en React para gestión de API keys (mencionado en `CLAUDE_INTEGRATION.md` pero no necesario para el MCP)
- Autenticación OAuth entre Claude.ai y el MCP (se resuelve con restricción de IP en GCP)
- Webhooks o push de cambios hacia el cliente MCP
