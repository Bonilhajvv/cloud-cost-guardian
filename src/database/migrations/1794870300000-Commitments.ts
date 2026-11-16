import { MigrationInterface, QueryRunner } from "typeorm";

export class Commitments1794870300000 implements MigrationInterface {
    name = 'Commitments1794870300000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS 'SAVINGS_PLAN_PURCHASE'`);
        await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS 'RESERVED_INSTANCE_PURCHASE'`);
        await queryRunner.query(`ALTER TYPE "public"."recommendations_source_enum" ADD VALUE IF NOT EXISTS 'COST_EXPLORER'`);
        await queryRunner.query(`ALTER TABLE "aws_accounts" ADD "commitments" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "aws_accounts" DROP COLUMN "commitments"`);
    }
}
