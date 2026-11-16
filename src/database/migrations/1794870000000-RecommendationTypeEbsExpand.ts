import { MigrationInterface, QueryRunner } from "typeorm";

export class RecommendationTypeEbsExpand1794870000000 implements MigrationInterface {
    name = 'RecommendationTypeEbsExpand1794870000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS 'EBS_EXPAND'`);
    }

    public async down(): Promise<void> {}
}
