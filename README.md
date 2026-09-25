# TaskyAPI

API de référence du cours **« Tasky Web : De Flutter au Web »**. C'est le backend que Tasky Web consomme à partir du Module 14 : authentification complète (vérification de l'e-mail par code, jetons d'accès, refresh token avec rotation), tâches paginées, filtrables et triables, catégories, et création idempotente pour le mode hors ligne.

Elle reprend le TaskyAPI construit dans le cours « TaskyAPI : De Zéro à un Backend Complet avec NestJS », avec l'évolution de sa leçon 20.5 (« Préparer TaskyAPI pour Tasky Web ») et le refresh token en cookie `HttpOnly`.

> Vous n'avez **pas besoin** de connaître NestJS pour utiliser cette API : une commande suffit pour la lancer, et toute sa documentation est dans Swagger.

---

## Démarrer en une commande

Prérequis : [Docker Desktop](https://www.docker.com/products/docker-desktop/) (ou Docker Engine avec Compose).

```bash
git clone <adresse-du-dépôt> tasky-api
cd tasky-api
docker compose up --build
```

Au premier démarrage, l'API applique les migrations et crée les données de départ. Quand le journal affiche « TaskyAPI prête », tout est disponible :

| Service | Adresse |
|---|---|
| API | http://localhost:3000 |
| Documentation Swagger (testable) | http://localhost:3000/docs |
| Contrat OpenAPI (JSON) | http://localhost:3000/docs-json (copie dans `docs/openapi.json`) |
| Boîte mail de développement (Mailpit) | http://localhost:8025 |
| État de l'API | http://localhost:3000/health |

**Compte de démonstration** (déjà vérifié, avec quelques tâches) : `demo@tasky.dev` / `Tasky2026!`

Les codes de vérification envoyés à l'inscription arrivent dans **Mailpit** (http://localhost:8025) et s'affichent aussi dans les journaux de l'API.

Commandes utiles :

```bash
docker compose up -d          # en arrière-plan
docker compose logs -f api    # suivre les journaux de l'API
docker compose down           # arrêter (les données sont conservées)
docker compose down -v        # arrêter ET effacer la base
```

---

## Le contrat de l'API

Toutes les erreurs ont le même format :

```json
{ "statusCode": 404, "message": "Tâche 42 introuvable.", "error": "Not Found", "path": "/tasks/42", "timestamp": "2026-09-25T09:24:15.225Z" }
```

`message` est une chaîne, ou un **tableau** de messages pour les erreurs de validation (400).

### Authentification

| Route | Corps | Réponse |
|---|---|---|
| `POST /auth/register` | `{ name, email, password }` (mot de passe ≥ 8) | 201 : l'utilisateur, **sans jeton**. Un code à 6 chiffres est envoyé par e-mail (valable 15 min). 409 si l'e-mail existe. |
| `POST /auth/verify-otp` | `{ email, code }` | 200 : l'utilisateur, `isVerified: true`. 400 si code incorrect ou expiré. |
| `POST /auth/resend-otp` | `{ email }` | 200 : message neutre (ne révèle pas si le compte existe). |
| `POST /auth/login` | `{ email, password }` | 200 : `{ access_token, token_type, user }` + refresh token (voir ci-dessous). 401 identifiants invalides, 403 e-mail non vérifié, 429 trop de tentatives. |
| `POST /auth/refresh` | `{ refresh_token }` (mode body) ou cookie | 200 : même forme que le login, avec un **nouveau** refresh token. 401 si invalide, expiré ou déjà utilisé. |
| `POST /auth/logout` | `{ refresh_token }` (mode body) ou cookie | 204 : la session est révoquée, le cookie effacé. |
| `GET /auth/me` | — (`Authorization: Bearer`) | 200 : l'utilisateur connecté. |

Un utilisateur : `{ id: number, email, name, isVerified: boolean, createdAt }`.

**Durées** : jeton d'accès 15 minutes, refresh token 7 jours.

**Rotation** : chaque refresh token ne sert qu'une fois. Présenter un refresh token déjà utilisé révoque toute la session (c'est le signe d'un vol).

**Deux modes de transport du refresh token**, choisis par l'en-tête `X-Token-Transport` :

| Mode | Pour qui | Fonctionnement |
|---|---|---|
| `body` (par défaut) | Applications mobiles (Tasky Flutter) | Le refresh token est dans le corps JSON (`refresh_token`), à ranger dans un stockage sécurisé. |
| `cookie` | Applications web (Tasky Web) | Le refresh token est placé dans un cookie `tasky_refresh` (`HttpOnly`, `SameSite=Strict`, `Path=/auth`), **illisible par JavaScript**, et absent du corps. |

En mode cookie, les requêtes vers `/auth/login`, `/auth/refresh` et `/auth/logout` doivent être envoyées avec `credentials: 'include'` et l'en-tête `X-Token-Transport: cookie`.

### Tâches

Toutes les routes exigent `Authorization: Bearer <access_token>`. Un utilisateur ne voit et ne modifie que ses propres tâches : **404** si la tâche n'existe pas, puis **403** si elle appartient à quelqu'un d'autre.

| Route | Détail |
|---|---|
| `GET /tasks` | Paginé : `{ data: Task[], meta: { total, page, limit, pages } }` |
| `GET /tasks/:id` | Une tâche |
| `POST /tasks` | Créer. **Idempotent** si `clientId` est fourni : rejouer la même création renvoie la même tâche. |
| `PATCH /tasks/:id` | Modifier partiellement (`{ "done": true }` suffit). `null` efface un champ facultatif. |
| `DELETE /tasks/:id` | 200 : la tâche supprimée |

Paramètres de `GET /tasks` : `page` (1), `limit` (10, maximum 100), `done` (`true`/`false`), `categoryId`, `priority` (`LOW`/`MEDIUM`/`HIGH`), `q` (recherche dans le titre), `sortBy` (`createdAt`, `updatedAt`, `dueDate`, `priority`, `title`, `id` ; par défaut `createdAt`), `sort` (`asc`/`desc`, par défaut `desc`), `clientId`.

Une tâche :

```json
{
  "id": 2,
  "clientId": null,
  "title": "Préparer la réunion d'équipe",
  "description": "Ordre du jour et chiffres du mois",
  "dueDate": "2026-09-27",
  "priority": "HIGH",
  "done": false,
  "categoryId": 1,
  "category": { "id": 1, "name": "Travail" },
  "userId": 1,
  "createdAt": "2026-09-25T09:23:48.663Z",
  "updatedAt": "2026-09-25T09:23:48.663Z"
}
```

Champs acceptés à la création : `title` (obligatoire, ≤ 200), `description` (≤ 2000), `dueDate` (`AAAA-MM-JJ`), `priority`, `categoryId`, `clientId` (UUID), `done`. Tout champ inconnu est refusé (400).

### Catégories

`GET /categories` : `[{ id, name }]`. Quatre catégories sont créées au démarrage : **Travail**, **Personnel**, **Courses**, **Santé** (elles correspondent aux catégories `work`, `personal`, `shopping` et `health` de Tasky Web).

---

## Développer sans Docker

Prérequis : Node.js 20.19 ou plus récent, et un PostgreSQL accessible.

```bash
cp .env.example .env          # adaptez DATABASE_URL
npm install                   # génère aussi le client Prisma
npx prisma migrate deploy     # crée les tables
npm run seed                  # catégories + compte de démonstration
npm run start:dev             # API sur http://localhost:3000
```

Tests de bout en bout (sur la base de `DATABASE_URL`) :

```bash
npm run test:e2e
```

---

## Différences avec le cours NestJS

Le code suit l'architecture du cours (modules, contrôleurs, services, DTO validés, garde JWT, filtre d'erreurs), avec quelques différences à connaître si vous lisez le code :

- **Prisma 7** : la connexion est décrite dans `prisma.config.ts` (et non plus dans `schema.prisma`), le client est généré dans `src/generated/prisma`, et il se connecte à PostgreSQL via l'adaptateur `@prisma/adapter-pg`.
- **Refresh tokens stockés** (empreinte SHA-256) pour permettre la rotation et la révocation, là où le cours utilisait des jetons sans état.
- **Deux modes de transport** du refresh token (voir plus haut), pour servir à la fois l'application mobile et l'application web.
- **Envoi des e-mails** sans file d'attente Redis : l'envoi part en arrière-plan sans bloquer la requête, ce qui suffit pour un backend de référence.

## Licence

MIT
