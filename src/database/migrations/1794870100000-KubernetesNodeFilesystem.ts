import { MigrationInterface, QueryRunner } from "typeorm";

export class KubernetesNodeFilesystem1794870100000 implements MigrationInterface {
    name = 'KubernetesNodeFilesystem1794870100000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_usage_samples" ADD "fsUsedBytes" bigint`);
        await queryRunner.query(`ALTER TABLE "kubernetes_usage_samples" ADD "fsCapacityBytes" bigint`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_usage_samples" DROP COLUMN "fsCapacityBytes"`);
        await queryRunner.query(`ALTER TABLE "kubernetes_usage_samples" DROP COLUMN "fsUsedBytes"`);
    }
}
