import { MigrationInterface, QueryRunner } from "typeorm";

export class Network1794870400000 implements MigrationInterface {
    name = 'Network1794870400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const value of ['EIP_UNUSED', 'NAT_GATEWAY_IDLE', 'LOAD_BALANCER_IDLE', 'VPC_ENDPOINT_MISSING', 'RDS_PUBLIC_ACCESS']) {
            await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS '${value}'`);
        }
        await queryRunner.query(`ALTER TABLE "aws_accounts" ADD "network" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "aws_accounts" DROP COLUMN "network"`);
    }
}
