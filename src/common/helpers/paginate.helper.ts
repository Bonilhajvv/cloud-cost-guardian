import { PaginationQueryDto } from '../dto/pagination.dto';
import { Paginated } from '../interfaces/paginated.interface';

export function paginate<T>(items: T[], total: number, query: PaginationQueryDto): Paginated<T> {
  return {
    items,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
