import { ApiProperty } from '@nestjs/swagger';

export class InstallCommandsDto {
  @ApiProperty() kubectl: string;
  @ApiProperty() helm: string;
  @ApiProperty() uninstallKubectl: string;
  @ApiProperty() uninstallHelm: string;
}

export class ClusterInstallDto {
  @ApiProperty() clusterId: string;
  @ApiProperty() installToken: string;
  @ApiProperty() expiresAt: Date;
  @ApiProperty() manifestUrl: string;
  @ApiProperty({ type: InstallCommandsDto }) commands: InstallCommandsDto;
  @ApiProperty({ type: [String] }) requirements: string[];
}
