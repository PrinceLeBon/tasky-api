/**
 * Données de départ (idempotent : peut être relancé sans créer de doublons).
 * - Les 4 catégories attendues par Tasky Web : Travail, Personnel, Courses, Santé.
 * - Un compte de démonstration vérifié, avec quelques tâches.
 */
import { config } from 'dotenv';
config({ quiet: true });
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../generated/prisma/client';

export const CATEGORY_NAMES = ['Travail', 'Personnel', 'Courses', 'Santé'] as const;
export const DEMO_EMAIL = 'demo@tasky.dev';
export const DEMO_PASSWORD = 'Tasky2026!';

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    for (const name of CATEGORY_NAMES) {
      await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
    }
    const categories = await prisma.category.findMany();
    const id = (name: string) => categories.find((c) => c.name === name)?.id;

    const demo = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: {},
      create: {
        email: DEMO_EMAIL,
        name: 'Compte de démonstration',
        password: await bcrypt.hash(DEMO_PASSWORD, 10),
        isVerified: true,
      },
    });

    if ((await prisma.task.count({ where: { userId: demo.id } })) === 0) {
      const inDays = (d: number) => new Date(`${new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
      await prisma.task.createMany({
        data: [
          { title: 'Acheter du pain', priority: 'LOW', categoryId: id('Courses'), userId: demo.id },
          { title: 'Préparer la réunion d’équipe', description: 'Ordre du jour et chiffres du mois', priority: 'HIGH', dueDate: inDays(2), categoryId: id('Travail'), userId: demo.id },
          { title: 'Prendre rendez-vous chez le dentiste', priority: 'MEDIUM', dueDate: inDays(7), categoryId: id('Santé'), userId: demo.id },
          { title: 'Appeler maman', priority: 'MEDIUM', categoryId: id('Personnel'), done: true, userId: demo.id },
          { title: 'Relire le cours Tasky Web', priority: 'LOW', userId: demo.id },
        ],
      });
    }
    console.log(`Seed terminé. Compte de démonstration : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
