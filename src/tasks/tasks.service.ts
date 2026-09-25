import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTaskDto, ListTasksQuery, UpdateTaskDto } from './dto/task.dto';

const include = { category: { select: { id: true, name: true } } } as const;
type TaskWithCategory = Prisma.TaskGetPayload<{ include: typeof include }>;

/** Format de réponse d'une tâche : `dueDate` en AAAA-MM-JJ, dates en ISO 8601. */
export function toTaskResponse(task: TaskWithCategory) {
  return {
    id: task.id,
    clientId: task.clientId,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
    priority: task.priority,
    done: task.done,
    categoryId: task.categoryId,
    category: task.category,
    userId: task.userId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/** Convertit `dueDate` (AAAA-MM-JJ) en Date pour Prisma ; les autres champs passent tels quels. */
function toData<T extends { dueDate?: string | null }>(dto: T): Omit<T, 'dueDate'> & { dueDate?: Date | null } {
  const { dueDate, ...rest } = dto;
  if (dueDate === undefined) return rest;
  return { ...rest, dueDate: dueDate === null ? null : new Date(`${dueDate}T00:00:00.000Z`) };
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number, query: ListTasksQuery) {
    const where: Prisma.TaskWhereInput = {
      userId,
      ...(query.done !== undefined && { done: query.done }),
      ...(query.categoryId !== undefined && { categoryId: query.categoryId }),
      ...(query.priority !== undefined && { priority: query.priority }),
      ...(query.clientId !== undefined && { clientId: query.clientId }),
      ...(query.q && { title: { contains: query.q, mode: 'insensitive' } }),
    };
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = [{ [query.sortBy]: query.sort }, { id: query.sort }];
    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({ where, orderBy, skip: (query.page - 1) * query.limit, take: query.limit, include }),
      this.prisma.task.count({ where }),
    ]);
    return {
      data: tasks.map(toTaskResponse),
      meta: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) },
    };
  }

  async findOne(userId: number, id: number) {
    return toTaskResponse(await this.findOwned(userId, id));
  }

  /** Création idempotente : rejouer la même création avec le même clientId renvoie la tâche existante. */
  async create(userId: number, dto: CreateTaskDto) {
    if (dto.clientId) {
      const existing = await this.prisma.task.findUnique({ where: { clientId: dto.clientId }, include });
      if (existing) {
        if (existing.userId !== userId) throw new ForbiddenException('Cet identifiant client est déjà utilisé.');
        return toTaskResponse(existing);
      }
    }
    try {
      const task = await this.prisma.task.create({ data: { ...toData(dto), userId }, include });
      return toTaskResponse(task);
    } catch (error) {
      // Deux créations simultanées avec le même clientId : la contrainte unique tranche.
      if (dto.clientId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.task.findUnique({ where: { clientId: dto.clientId }, include });
        if (existing && existing.userId === userId) return toTaskResponse(existing);
      }
      throw error;
    }
  }

  async update(userId: number, id: number, dto: UpdateTaskDto) {
    await this.findOwned(userId, id);
    const { clientId: _ignored, ...changes } = dto; // l'identifiant client ne change pas après création
    const task = await this.prisma.task.update({ where: { id }, data: toData(changes), include });
    return toTaskResponse(task);
  }

  async remove(userId: number, id: number) {
    await this.findOwned(userId, id);
    const task = await this.prisma.task.delete({ where: { id }, include });
    return toTaskResponse(task);
  }

  /** 404 si la tâche n'existe pas, puis 403 si elle appartient à un autre utilisateur. */
  private async findOwned(userId: number, id: number) {
    const task = await this.prisma.task.findUnique({ where: { id }, include });
    if (!task) throw new NotFoundException(`Tâche ${id} introuvable.`);
    if (task.userId !== userId) throw new ForbiddenException('Cette tâche ne vous appartient pas.');
    return task;
  }
}
