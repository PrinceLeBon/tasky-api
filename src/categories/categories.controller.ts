import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Les catégories disponibles (Travail, Personnel, Courses, Santé)' })
  findAll() {
    return this.prisma.category.findMany({ orderBy: { id: 'asc' } });
  }
}
