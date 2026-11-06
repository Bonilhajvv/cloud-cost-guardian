import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AwsAccountsModule } from './aws-accounts/aws-accounts.module';
import { AwsModule } from './aws/aws.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { EnvironmentVariables, validateEnv } from './config/env.validation';
import { buildTypeOrmOptions } from './config/typeorm.config';
import { CostReportsModule } from './cost-reports/cost-reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { KubernetesModule } from './kubernetes/kubernetes.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { ResourceInventoryModule } from './resource-inventory/resource-inventory.module';
import { ScansModule } from './scans/scans.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        ...buildTypeOrmOptions({
          DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
          DATABASE_SSL: config.get('DATABASE_SSL', { infer: true }),
          DATABASE_POOL_SIZE: config.get('DATABASE_POOL_SIZE', { infer: true }),
        }),
        autoLoadEntities: true,
      }),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    AwsModule,
    AwsAccountsModule,
    ResourceInventoryModule,
    CostReportsModule,
    RecommendationsModule,
    ScansModule,
    KubernetesModule,
    DashboardModule,
    AdminModule,
    ConditionalModule.registerWhen(JobsModule, (env: NodeJS.ProcessEnv) => env.JOBS_ENABLED !== 'false'),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('{*path}');
  }
}
