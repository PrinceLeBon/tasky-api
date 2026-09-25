import { config } from 'dotenv';
config({ quiet: true });
process.env.RATE_LIMIT_DISABLED = 'true';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

describe('TaskyAPI (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();
  const alice = { name: 'Alice', email: `alice-${suffix}@test.dev`, password: 'MotDePasse2026' };
  const bob = { name: 'Bob', email: `bob-${suffix}@test.dev`, password: 'MotDePasse2026' };

  const http = () => request(app.getHttpServer());

  async function registerAndVerify(user: typeof alice) {
    await http().post('/auth/register').send(user).expect(201);
    const { otpCode } = await prisma.user.findUniqueOrThrow({ where: { email: user.email } });
    await http().post('/auth/verify-otp').send({ email: user.email, code: otpCode }).expect(200);
    const res = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
    return res.body as { access_token: string; refresh_token: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [alice.email, bob.email] } } });
    await app.close();
  });

  describe('authentification', () => {
    let tokens: { access_token: string; refresh_token: string };

    it('refuse la connexion tant que l’e-mail n’est pas vérifié', async () => {
      await http().post('/auth/register').send(alice).expect(201);
      const res = await http().post('/auth/login').send({ email: alice.email, password: alice.password }).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, path: '/auth/login' });
    });

    it('renvoie 409 si l’e-mail est déjà utilisé', async () => {
      await http().post('/auth/register').send(alice).expect(409);
    });

    it('renvoie le détail des erreurs de validation', async () => {
      const res = await http().post('/auth/register').send({ name: 'X', email: 'pas-un-email', password: 'court' }).expect(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.length).toBeGreaterThanOrEqual(3);
    });

    it('vérifie le code puis connecte (mode body)', async () => {
      const { otpCode } = await prisma.user.findUniqueOrThrow({ where: { email: alice.email } });
      await http().post('/auth/verify-otp').send({ email: alice.email, code: '000000' === otpCode ? '111111' : '000000' }).expect(400);
      await http().post('/auth/verify-otp').send({ email: alice.email, code: otpCode }).expect(200);
      const res = await http().post('/auth/login').send({ email: alice.email, password: alice.password }).expect(200);
      expect(res.body).toMatchObject({ token_type: 'Bearer', user: { email: alice.email, name: 'Alice' } });
      expect(typeof res.body.access_token).toBe('string');
      expect(typeof res.body.refresh_token).toBe('string');
      expect(res.body.user.password).toBeUndefined();
      tokens = res.body;
    });

    it('GET /auth/me exige un jeton valide', async () => {
      await http().get('/auth/me').expect(401);
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${tokens.access_token}`).expect(200);
      expect(res.body.email).toBe(alice.email);
    });

    it('fait tourner le refresh token et détecte sa réutilisation', async () => {
      const first = await http().post('/auth/refresh').send({ refresh_token: tokens.refresh_token }).expect(200);
      expect(first.body.refresh_token).not.toBe(tokens.refresh_token);
      // Réutiliser l'ancien jeton : refusé, et toute la famille est révoquée.
      await http().post('/auth/refresh').send({ refresh_token: tokens.refresh_token }).expect(401);
      await http().post('/auth/refresh').send({ refresh_token: first.body.refresh_token }).expect(401);
    });

    it('deux renouvellements simultanés avec le même jeton révoquent toute la session', async () => {
      const login = await http().post('/auth/login').send({ email: alice.email, password: alice.password }).expect(200);
      const token = login.body.refresh_token as string;
      const results = await Promise.all([
        http().post('/auth/refresh').send({ refresh_token: token }),
        http().post('/auth/refresh').send({ refresh_token: token }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      const winner = results.find((r) => r.status === 200)!.body.refresh_token as string;
      // même le jeton émis à la requête « gagnante » est refusé : la session est compromise
      await http().post('/auth/refresh').send({ refresh_token: winner }).expect(401);
    });

    it('mode cookie : refresh token dans un cookie HttpOnly, absent du corps', async () => {
      const login = await http()
        .post('/auth/login')
        .set('X-Token-Transport', 'cookie')
        .send({ email: alice.email, password: alice.password })
        .expect(200);
      expect(login.body.refresh_token).toBeUndefined();
      const cookie = ([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('tasky_refresh='));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/auth/);
      expect(cookie).toMatch(/SameSite=Strict/i);

      const refreshed = await http().post('/auth/refresh').set('X-Token-Transport', 'cookie').set('Cookie', cookie!.split(';')[0]).expect(200);
      expect(refreshed.body.access_token).toBeDefined();
      expect(refreshed.body.user.email).toBe(alice.email);
      const newCookie = ([] as string[]).concat(refreshed.headers['set-cookie'] ?? []).find((c) => c.startsWith('tasky_refresh='));

      await http().post('/auth/logout').set('Cookie', newCookie!.split(';')[0]).expect(204);
      await http().post('/auth/refresh').set('Cookie', newCookie!.split(';')[0]).expect(401);
    });
  });

  describe('tâches', () => {
    let aliceToken: string;
    let bobToken: string;
    let taskId: number;

    beforeAll(async () => {
      aliceToken = (await http().post('/auth/login').send({ email: alice.email, password: alice.password })).body.access_token;
      bobToken = (await registerAndVerify(bob)).access_token;
    });

    it('exige un jeton', async () => {
      await http().get('/tasks').expect(401);
    });

    it('crée une tâche complète', async () => {
      const categories = (await http().get('/categories').expect(200)).body as { id: number; name: string }[];
      const courses = categories.find((c) => c.name === 'Courses')!;
      const res = await http()
        .post('/tasks')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ title: 'Acheter du pain', description: 'Complet', dueDate: '2026-12-31', priority: 'HIGH', categoryId: courses.id })
        .expect(201);
      expect(res.body).toMatchObject({
        title: 'Acheter du pain',
        description: 'Complet',
        dueDate: '2026-12-31',
        priority: 'HIGH',
        done: false,
        category: { id: courses.id, name: 'Courses' },
      });
      taskId = res.body.id;
    });

    it('refuse les champs inconnus et une catégorie inexistante', async () => {
      await http().post('/tasks').set('Authorization', `Bearer ${aliceToken}`).send({ title: 'x', completed: true }).expect(400);
      await http().post('/tasks').set('Authorization', `Bearer ${aliceToken}`).send({ title: 'x', categoryId: 999999 }).expect(400);
    });

    it('rend la création idempotente avec clientId', async () => {
      const body = { title: 'Hors ligne', clientId: '8f14e45f-ceea-467a-9d6c-2b4f6a1e3c11' };
      const a = await http().post('/tasks').set('Authorization', `Bearer ${aliceToken}`).send(body).expect(201);
      const b = await http().post('/tasks').set('Authorization', `Bearer ${aliceToken}`).send(body).expect(201);
      expect(b.body.id).toBe(a.body.id);
      expect(await prisma.task.count({ where: { clientId: body.clientId } })).toBe(1);
      await http().post('/tasks').set('Authorization', `Bearer ${bobToken}`).send(body).expect(403);
    });

    it('pagine, filtre et trie', async () => {
      for (let i = 0; i < 12; i++) {
        await http().post('/tasks').set('Authorization', `Bearer ${aliceToken}`).send({ title: `Tâche ${i}`, done: i % 2 === 0 });
      }
      const page = await http().get('/tasks?page=2&limit=5').set('Authorization', `Bearer ${aliceToken}`).expect(200);
      expect(page.body.data).toHaveLength(5);
      expect(page.body.meta).toEqual({ total: 14, page: 2, limit: 5, pages: 3 });
      const done = await http().get('/tasks?done=true&limit=100').set('Authorization', `Bearer ${aliceToken}`).expect(200);
      expect(done.body.data.every((t: { done: boolean }) => t.done)).toBe(true);
      const search = await http().get('/tasks?q=PAIN').set('Authorization', `Bearer ${aliceToken}`).expect(200);
      expect(search.body.data.map((t: { title: string }) => t.title)).toEqual(['Acheter du pain']);
      await http().get('/tasks?limit=500').set('Authorization', `Bearer ${aliceToken}`).expect(400);
    });

    it('modifie partiellement, efface un champ avec null', async () => {
      const res = await http()
        .patch(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ done: true, dueDate: null })
        .expect(200);
      expect(res.body).toMatchObject({ done: true, dueDate: null, title: 'Acheter du pain' });
    });

    it('404 pour une tâche inexistante, 403 pour la tâche d’un autre', async () => {
      await http().get('/tasks/99999999').set('Authorization', `Bearer ${aliceToken}`).expect(404);
      await http().get(`/tasks/${taskId}`).set('Authorization', `Bearer ${bobToken}`).expect(403);
      await http().delete(`/tasks/${taskId}`).set('Authorization', `Bearer ${bobToken}`).expect(403);
    });

    it('supprime et renvoie la tâche supprimée', async () => {
      const res = await http().delete(`/tasks/${taskId}`).set('Authorization', `Bearer ${aliceToken}`).expect(200);
      expect(res.body.id).toBe(taskId);
      await http().get(`/tasks/${taskId}`).set('Authorization', `Bearer ${aliceToken}`).expect(404);
    });
  });
});
