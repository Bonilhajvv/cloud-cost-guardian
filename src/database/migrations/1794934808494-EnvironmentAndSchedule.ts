import { MigrationInterface, QueryRunner } from "typeorm";

export class EnvironmentAndSchedule1794934808494 implements MigrationInterface {
    name = 'EnvironmentAndSchedule1794934808494'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS 'EC2_SCHEDULE'`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "workSchedule" jsonb`);
        await queryRunner.query(`ALTER TABLE "aws_resources" ADD "environment" character varying(32)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "aws_resources" DROP COLUMN "environment"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "workSchedule"`);
    }
}
