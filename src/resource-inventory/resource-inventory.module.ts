import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsResource } from './entities/aws-resource.entity';
import { ResourceInventoryController } from './resource-inventory.controller';
import { ResourceInventoryService } from './resource-inventory.service';

@Module({
  imports: [TypeOrmModule.forFeature([AwsResource])],
  controllers: [ResourceInventoryController],
  providers: [ResourceInventoryService],
  exports: [ResourceInventoryService],
})
export class ResourceInventoryModule {}
