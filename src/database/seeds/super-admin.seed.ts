import dataSource from '../data-source';
import { Role } from '../../common/enums';
import { User } from '../../users/entities/user.entity';
import { hashPassword } from '../../users/helpers/password.helper';

async function run(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (min 12 chars) are required');
  }
  await dataSource.initialize();
  const repo = dataSource.getRepository(User);
  const existing = await repo.findOneBy({ email });
  if (existing) {
    existing.platformRole = Role.SUPER_ADMIN;
    await repo.save(existing);
    console.log(JSON.stringify({ msg: 'Existing user promoted to SUPER_ADMIN', email }));
  } else {
    await repo.save(repo.create({ email, name: 'Platform Admin', passwordHash: await hashPassword(password), platformRole: Role.SUPER_ADMIN }));
    console.log(JSON.stringify({ msg: 'SUPER_ADMIN created', email }));
  }
  await dataSource.destroy();
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
