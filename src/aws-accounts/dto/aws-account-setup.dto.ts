import { ApiProperty } from '@nestjs/swagger';

export class CloudFormationSetupDto {
  @ApiProperty({ nullable: true, type: String }) quickCreateUrl: string | null;
  @ApiProperty() templateUrl: string;
  @ApiProperty() stackName: string;
}

export class AwsAccountSetupDto {
  @ApiProperty() awsAccountRef: string;
  @ApiProperty() externalId: string;
  @ApiProperty() platformAccountId: string;
  @ApiProperty() suggestedRoleName: string;
  @ApiProperty({ type: Object }) trustPolicy: Record<string, unknown>;
  @ApiProperty({ type: Object }) permissionsPolicy: Record<string, unknown>;
  @ApiProperty() expectedRoleArn: string;
  @ApiProperty({ type: CloudFormationSetupDto }) cloudFormation: CloudFormationSetupDto;
  @ApiProperty({ type: [String] }) steps: string[];
}
