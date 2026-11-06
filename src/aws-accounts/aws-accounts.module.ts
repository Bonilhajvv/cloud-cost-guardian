import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsCoreModule } from '../aws/core/aws-core.module';
import { AwsAccountsController } from './aws-accounts.controller';
import { AwsAccountsService } from './aws-accounts.service';
import { AwsAccount } from './entities/aws-account.entity';
import { PublicTemplatesController } from './public-templates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AwsAccount]), AwsCoreModule],
  controllers: [AwsAccountsController, PublicTemplatesController],
  providers: [AwsAccountsService],
  exports: [AwsAccountsService],
})
export class AwsAccountsModule {}
