import { MigrationInterface, QueryRunner } from "typeorm";

export class RecommendationTypesStoppedUpsize1794261600000 implements MigrationInterface {
    name = 'RecommendationTypesStoppedUpsize1794261600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS 'EC2_STOPPED'`);
        await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS 'EC2_UPSIZE'`);
    }

    public async down(): Promise<void> {}
}
