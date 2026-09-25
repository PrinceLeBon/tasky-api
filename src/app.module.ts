import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { CategoriesController } from './categories/categories.controller';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120) }],
      skipIf: () => process.env.RATE_LIMIT_DISABLED === 'true',
    }),
    PrismaModule,
    MailModule,
    AuthModule,
    TasksModule,
  ],
  controllers: [CategoriesController, HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
