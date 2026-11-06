import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { ORG_READ_ROLES, Role } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { AddMemberDto } from './dto/add-member.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(...ORG_READ_ROLES)
  list(@CurrentUser() user: TenantUser, @Query() query: PaginationQueryDto) {
    return this.users.listMembers(user.organizationId, query);
  }

  @Post()
  @Roles(Role.ORG_ADMIN)
  add(@CurrentUser() user: TenantUser, @Body() dto: AddMemberDto) {
    return this.users.addMember(user.organizationId, dto);
  }

  @Delete(':userId')
  @HttpCode(204)
  @Roles(Role.ORG_ADMIN)
  remove(@CurrentUser() user: TenantUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.users.removeMember(user.organizationId, userId, user.userId);
  }
}
