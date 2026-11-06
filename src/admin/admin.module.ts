import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { CostReportsModule } from '../cost-reports/cost-reports.module';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { AwsResource } from '../resource-inventory/entities/aws-resource.entity';
import { User } from '../users/entities/user.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, User, AwsAccount, AwsResource, Recommendation, AuditLog]),
    OrganizationsModule,
    RecommendationsModule,
    CostReportsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
