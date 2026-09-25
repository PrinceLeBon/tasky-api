import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type PriorityValue = (typeof PRIORITIES)[number];

export class CreateTaskDto {
  @ApiProperty({ example: 'Acheter du pain', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'Pain complet, à la boulangerie du coin', maxLength: 2000, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Date au format AAAA-MM-JJ', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString({ strict: true })
  dueDate?: string | null;

  @ApiPropertyOptional({ enum: PRIORITIES, default: 'MEDIUM' })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: PriorityValue;

  @ApiPropertyOptional({ example: 3, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  categoryId?: number | null;

  @ApiPropertyOptional({ description: 'Identifiant généré par le client (UUID), pour le mode hors ligne' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class UpdateTaskDto extends PartialType(CreateTaskDto) {}

const SORT_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'priority', 'title', 'id'] as const;

export class ListTasksQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;

  @ApiPropertyOptional({ description: 'Filtrer sur l’état terminé' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: PriorityValue;

  @ApiPropertyOptional({ description: 'Recherche dans le titre (insensible à la casse)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: (typeof SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc', description: 'Sens du tri (compatible avec le cours NestJS)' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Retrouver une tâche par son identifiant client' })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
