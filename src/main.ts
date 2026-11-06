import 'reflect-metadata';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/env.validation';
import { setupSwagger } from './config/swagger.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({
      json: process.env.LOG_JSON === 'true',
      colors: process.env.LOG_JSON !== 'true',
      logLevels: process.env.NODE_ENV === 'production' ? ['log', 'warn', 'error', 'fatal'] : undefined,
    }),
  });
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.set('trust proxy', true);
  app.useBodyParser('json', { limit: '10mb' });
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const origins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({ origin: origins ? origins.split(',').map((o) => o.trim()) : false });
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) setupSwagger(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log({
    msg: 'Cloud Cost Guardian API started',
    port,
    env: config.get('NODE_ENV', { infer: true }),
    jobsEnabled: config.get('JOBS_ENABLED', { infer: true }),
  });
}

void bootstrap();
