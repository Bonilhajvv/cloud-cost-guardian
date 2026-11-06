import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { AWS_REGION_PATTERN, ROLE_ARN_PATTERN } from '../constants/aws-account.constant';

export class CreateAwsAccountDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @Matches(/^\d{12}$/, { message: 'awsAccountId must be a 12-digit AWS account id' })
  awsAccountId: string;

  @Matches(AWS_REGION_PATTERN, { message: 'defaultRegion must be a valid AWS region, e.g. us-east-1' })
  defaultRegion: string;

  @IsOptional()
  @Matches(ROLE_ARN_PATTERN, { message: 'roleArn must be an IAM role ARN' })
  roleArn?: string;
}
