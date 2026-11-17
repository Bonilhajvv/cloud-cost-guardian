import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OrganizationStatus } from '../common/enums';
import { Organization } from './entities/organization.entity';
import { slugify } from './helpers/slugify.helper';
import { effectiveWorkSchedule } from './helpers/work-schedule.helper';
import { EffectiveWorkSchedule, WorkSchedule } from './interfaces/work-schedule.interface';

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

  async workSchedule(id: string): Promise<EffectiveWorkSchedule> {
    return effectiveWorkSchedule((await this.findById(id)).workSchedule);
  }

  async setWorkSchedule(id: string, schedule: WorkSchedule | null): Promise<EffectiveWorkSchedule> {
    if (schedule && schedule.endHour <= schedule.startHour) throw new BadRequestException('endHour must be greater than startHour');
    const org = await this.findById(id);
    org.workSchedule = schedule ? { days: schedule.days, startHour: schedule.startHour, endHour: schedule.endHour, timezone: schedule.timezone } : null;
    await this.repo.save(org);
    return effectiveWorkSchedule(org.workSchedule);
  }

  async setStatus(id: string, status: OrganizationStatus): Promise<Organization> {
    const org = await this.findById(id);
    org.status = status;
    org.suspendedAt = status === OrganizationStatus.SUSPENDED ? new Date() : null;
    return this.repo.save(org);
  }
}
