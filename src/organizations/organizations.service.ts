import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OrganizationStatus } from '../common/enums';
import { Organization } from './entities/organization.entity';
import { slugify } from './helpers/slugify.helper';

@Injectable()
export class OrganizationsService {
  constructor(@InjectRepository(Organization) private readonly repo: Repository<Organization>) {}

  create(name: string, manager: EntityManager = this.repo.manager): Promise<Organization> {
    return manager.save(manager.create(Organization, { name, slug: slugify(name) }));
  }

  async findById(id: string): Promise<Organization> {
    const org = await this.repo.findOneBy({ id });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async rename(id: string, name: string): Promise<Organization> {
    const org = await this.findById(id);
    org.name = name;
    return this.repo.save(org);
  }

  async setStatus(id: string, status: OrganizationStatus): Promise<Organization> {
    const org = await this.findById(id);
    org.status = status;
    org.suspendedAt = status === OrganizationStatus.SUSPENDED ? new Date() : null;
    return this.repo.save(org);
  }
}
