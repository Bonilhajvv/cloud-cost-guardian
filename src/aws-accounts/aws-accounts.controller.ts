import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { AwsAccountsService } from './aws-accounts.service';
import { AwsAccountSetupDto } from './dto/aws-account-setup.dto';
import { CreateAwsAccountDto } from './dto/create-aws-account.dto';
import { ListAwsAccountsDto } from './dto/list-aws-accounts.dto';
import { UpdateAwsAccountDto } from './dto/update-aws-account.dto';

@ApiTags('AWS Accounts')
@ApiBearerAuth()
@Controller('aws-accounts')
export class AwsAccountsController {
  constructor(private readonly accounts: AwsAccountsService) {}

  @Post()
  @Roles(Role.ORG_ADMIN)
  create(@CurrentUser() user: TenantUser, @Body() dto: CreateAwsAccountDto) {
    return this.accounts.create(user, dto);
  }

  @Get()
  @Roles(...ORG_READ_ROLES)
  list(@CurrentUser() user: TenantUser, @Query() query: ListAwsAccountsDto) {
    return this.accounts.list(user.organizationId, query);
  }

  @Get(':id')
  @Roles(...ORG_READ_ROLES)
  get(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(user.organizationId, id);
  }

  @Get(':id/setup')
  @Roles(Role.ORG_ADMIN)
  @ApiOkResponse({ type: AwsAccountSetupDto })
  setup(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.getSetup(user.organizationId, id);
  }

  @Patch(':id')
  @Roles(Role.ORG_ADMIN)
  update(
    @CurrentUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAwsAccountDto,
  ) {
    return this.accounts.update(user.organizationId, id, dto);
  }

  @Post(':id/test-connection')
  @HttpCode(200)
  @Roles(Role.ORG_ADMIN)
  test(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.testConnection(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.ORG_ADMIN)
  disconnect(@CurrentUser() user: TenantUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.disconnect(user, id);
  }
}
