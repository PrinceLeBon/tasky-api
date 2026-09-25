import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateTaskDto, ListTasksQuery, UpdateTaskDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Lister ses tâches (paginé, filtrable, triable)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListTasksQuery) {
    return this.tasks.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Une tâche' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.findOne(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Créer une tâche (idempotent si clientId est fourni)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une tâche (partiellement)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer une tâche (renvoie la tâche supprimée)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.remove(user.id, id);
  }
}
