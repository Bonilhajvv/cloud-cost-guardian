import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { buildCloudFormationTemplate } from './helpers/cloudformation.helper';

@ApiTags('Public')
@Public()
@Controller('public')
export class PublicTemplatesController {
  @Get('cloudformation/readonly-role.json')
  @Header('Cache-Control', 'public, max-age=3600')
  cloudFormationTemplate() {
    return buildCloudFormationTemplate();
  }
}
