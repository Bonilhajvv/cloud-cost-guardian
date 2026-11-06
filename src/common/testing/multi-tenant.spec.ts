import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AwsAccountsService } from '../../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../../aws-accounts/entities/aws-account.entity';
import { AwsConnectionService } from '../../aws/core/aws-connection.service';
import { AwsCredentialsService } from '../../aws/core/aws-credentials.service';
import { PrincipalService } from '../../auth/principal.service';
import { EnvironmentVariables } from '../../config/env.validation';
import { OrganizationUser } from '../../organizations/entities/organization-user.entity';
import { Recommendation } from '../../recommendations/entities/recommendation.entity';
import { RecommendationsService } from '../../recommendations/recommendations.service';
import { AwsResource } from '../../resource-inventory/entities/aws-resource.entity';
import { ResourceInventoryService } from '../../resource-inventory/resource-inventory.service';
import { User } from '../../users/entities/user.entity';
import { OrganizationStatus, RecommendationStatus, Role } from '../enums';
import { TenantUser } from '../interfaces/request-user.interface';
import { repositoryMock } from './repository.mock';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const userB: TenantUser = { userId: 'user-b', email: 'b@beta.com', role: Role.ORG_ADMIN, organizationId: ORG_B };

const audit = { log: jest.fn() } as unknown as AuditService;

describe('Multi-tenant isolation', () => {
  describe('AwsAccountsService', () => {
    const repo = repositoryMock<AwsAccount>();
    const service = new AwsAccountsService(
      repo as unknown as Repository<AwsAccount>,
      { test: jest.fn() } as unknown as AwsConnectionService,
      { invalidate: jest.fn() } as unknown as AwsCredentialsService,
      audit,
      { get: jest.fn() } as unknown as ConfigService<EnvironmentVariables, true>,
    );

    beforeEach(() => repo.findOneBy.mockReset());

    it('always scopes lookups by organizationId', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.get(ORG_B, 'account-of-a')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'account-of-a', organizationId: ORG_B });
    });

    it('cannot test the connection of another tenant account', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.testConnection(userB, 'account-of-a')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cannot disconnect another tenant account', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.disconnect(userB, 'account-of-a')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('RecommendationsService', () => {
    const repo = repositoryMock<Recommendation>();
    const service = new RecommendationsService(repo as unknown as Repository<Recommendation>, audit);

    it('cannot read another tenant recommendation', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.get(ORG_B, 'rec-of-a')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'rec-of-a', organizationId: ORG_B });
    });

    it('cannot change status of another tenant recommendation', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(
        service.updateStatus(userB, 'rec-of-a', { status: RecommendationStatus.ACCEPTED }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects invalid status transitions', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'r1', organizationId: ORG_B, status: RecommendationStatus.RESOLVED, metadata: {} } as Recommendation);
      await expect(
        service.updateStatus(userB, 'r1', { status: RecommendationStatus.OPEN }),
      ).rejects.toThrow('Cannot change status from RESOLVED to OPEN');
    });
  });

  describe('ResourceInventoryService', () => {
    const repo = repositoryMock<AwsResource>();
    const service = new ResourceInventoryService(repo as unknown as Repository<AwsResource>);

    it('cannot read another tenant resource', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.get(ORG_B, 'res-of-a')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'res-of-a', organizationId: ORG_B });
    });
  });

  describe('PrincipalService', () => {
    const users = repositoryMock<User>();
    const members = repositoryMock<OrganizationUser>();
    const service = new PrincipalService(
      users as unknown as Repository<User>,
      members as unknown as Repository<OrganizationUser>,
    );
    const membership = (status: OrganizationStatus, isActive = true) =>
      ({
        userId: 'u1',
        organizationId: ORG_A,
        role: Role.ORG_MEMBER,
        user: { email: 'u@acme.com', isActive },
        organization: { status },
      }) as OrganizationUser;

    it('resolves the role from the membership of the token organization', async () => {
      members.findOne.mockResolvedValue(membership(OrganizationStatus.ACTIVE));
      await expect(service.resolve('u1', ORG_A)).resolves.toEqual({
        userId: 'u1',
        email: 'u@acme.com',
        role: Role.ORG_MEMBER,
        organizationId: ORG_A,
      });
      expect(members.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', organizationId: ORG_A } }));
    });

    it('rejects users that are not members of the organization', async () => {
      members.findOne.mockResolvedValue(null);
      await expect(service.resolve('u1', ORG_B)).resolves.toBeNull();
    });

    it('rejects suspended organizations', async () => {
      members.findOne.mockResolvedValue(membership(OrganizationStatus.SUSPENDED));
      await expect(service.resolve('u1', ORG_A)).resolves.toBeNull();
    });

    it('rejects inactive users', async () => {
      members.findOne.mockResolvedValue(membership(OrganizationStatus.ACTIVE, false));
      await expect(service.resolve('u1', ORG_A)).resolves.toBeNull();
    });

    it('grants platform scope only to SUPER_ADMIN', async () => {
      users.findOneBy.mockResolvedValueOnce({ id: 'u1', email: 'x', platformRole: null } as User);
      await expect(service.resolve('u1', null)).resolves.toBeNull();
      users.findOneBy.mockResolvedValueOnce({ id: 'u2', email: 'root', platformRole: Role.SUPER_ADMIN } as User);
      await expect(service.resolve('u2', null)).resolves.toMatchObject({ role: Role.SUPER_ADMIN, organizationId: null });
    });
  });
});
