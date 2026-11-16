import { MigrationInterface, QueryRunner } from "typeorm";

export class RecommendationTypesRds1794870200000 implements MigrationInterface {
    name = 'RecommendationTypesRds1794870200000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const value of ['RDS_UPSIZE', 'RDS_IDLE', 'RDS_MULTI_AZ', 'RDS_EXTENDED_SUPPORT']) {
            await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS '${value}'`);
        }
    }

    public async down(): Promise<void> {}
}
