import { ObjectLiteral, Repository } from 'typeorm';

export type RepositoryMock<T extends ObjectLiteral> = jest.Mocked<Pick<Repository<T>, 'findOneBy' | 'findOne' | 'save' | 'find' | 'findAndCount' | 'create'>>;

export function repositoryMock<T extends ObjectLiteral>(): RepositoryMock<T> {
  return {
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (v) => v),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn((v) => v),
  } as unknown as RepositoryMock<T>;
}
