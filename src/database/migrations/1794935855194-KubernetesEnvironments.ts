import { MigrationInterface, QueryRunner } from "typeorm";

export class KubernetesEnvironments1794935855194 implements MigrationInterface {
    name = 'KubernetesEnvironments1794935855194'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const value of ['K8S_NODE_GROUP_SCHEDULE', 'K8S_NAMESPACE_SCHEDULE']) {
            await queryRunner.query(`ALTER TYPE "public"."recommendations_type_enum" ADD VALUE IF NOT EXISTS '${value}'`);
        }
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" ADD "environment" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" ADD "namespaceEnvironments" jsonb NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" DROP COLUMN "namespaceEnvironments"`);
        await queryRunner.query(`ALTER TABLE "kubernetes_clusters" DROP COLUMN "environment"`);
    }
}
