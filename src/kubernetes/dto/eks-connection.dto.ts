import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import { AWS_REGION_PATTERN } from '../../aws-accounts/constants/aws-account.constant';
import { EKS_CLUSTER_NAME_PATTERN } from '../constants/eks-connection.constant';

export class CreateEksConnectionDto {
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, { message: 'name may contain letters, numbers, dot, dash and underscore' })
  name: string;

  @IsUUID()
  awsAccountId: string;

  @Matches(EKS_CLUSTER_NAME_PATTERN, { message: 'eksClusterName must be a valid EKS cluster name' })
  eksClusterName: string;

  @Matches(AWS_REGION_PATTERN, { message: 'eksRegion must be a valid AWS region, e.g. us-east-1' })
  eksRegion: string;
}

export class EksConnectionDto {
  @ApiProperty() clusterId: string;
  @ApiProperty() roleArn: string;
  @ApiProperty() accessEntryCommand: string;
  @ApiProperty() rbacManifest: string;
  @ApiProperty({ type: [String] }) steps: string[];
  @ApiProperty({ type: [String] }) limitations: string[];
}

export class EksCollectResultDto {
  @ApiProperty() success: boolean;
  @ApiProperty() nodes: number;
  @ApiProperty() workloads: number;
  @ApiProperty({ nullable: true, type: String }) error: string | null;
}
