pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
        timestamps()
    }

    environment {
        DOCKER_BUILDKIT = '1'
        IMAGE_TAG = "${BUILD_NUMBER}"
        COMPOSE_PROJECT_NAME = "ecommerce-${BUILD_NUMBER}"
        DOCKERHUB_NAMESPACE = 'abdalrhman1'
        // AWS CD variables (uncomment and configure when enabling the AWS CD stage)
        // AWS_REGION = 'eu-north-1'
        // AWS_ACCOUNT_ID = '123456789012'
        // ECR_REGISTRY = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        // ECS_CLUSTER = 'ecommerce-prod-cluster'
    }

    stages {
        stage('Build environment setup') {
            steps {
                sh '''
                    set -eu
                    docker version
                    docker compose version
                    node --version
                    npm --version
                    curl --version
                    git --version
                    test -f package.json
                    test -f docker-compose.yml
                    test -f setup-local.mjs
                '''
            }
        }

        stage('Generate local env') {
            steps {
                sh '''
                    set -eu
                    # setup-local.mjs throws if .env already exists in a reused Jenkins workspace
                    rm -f .env
                    node setup-local.mjs
                '''
            }
        }

        stage('Validate Compose') {
            steps {
                sh 'docker compose config --quiet'
            }
        }

        stage('Gateway unit tests') {
            steps {
                dir('services/gateway') {
                    sh '''
                        set -eu
                        npm ci
                        npm test
                    '''
                }
            }
        }

        stage('Build all images') {
            steps {
                sh 'docker compose build'
            }
        }

        stage('Start test stack') {
            steps {
                sh 'docker compose up -d --wait --wait-timeout 240'
            }
        }

        stage('Smoke tests') {
            steps {
                sh '''
                    set -eu

                    curl --fail --retry 20 --retry-connrefused \
                        --retry-delay 2 --max-time 5 \
                        http://127.0.0.1:3000/health

                    curl --fail --retry 20 --retry-connrefused \
                        --retry-delay 2 --max-time 5 \
                        http://127.0.0.1:3010/health

                    docker compose exec -T commerce sh -c \
                        'TEST_APP_URL=http://web:3000 TEST_COMMERCE_URL=http://localhost:3000 node /app/scripts/compose-smoke.mjs'
                '''
            }
        }

        stage('Push images to Docker Hub') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'DH_USER', passwordVariable: 'DH_TOKEN')]) {
                    sh '''
                        set -eu
                        set +x
                        echo "$DH_TOKEN" | docker login -u "$DH_USER" --password-stdin

                        # Compose builds <COMPOSE_PROJECT_NAME>-<service>:latest for identity, gateway, commerce, web
                        # (worker reuses the commerce image with a different command)
                        for svc in identity gateway commerce web; do
                            LOCAL_IMG="${COMPOSE_PROJECT_NAME}-${svc}:latest"
                            REMOTE_TAG="${DOCKERHUB_NAMESPACE}/ecommerce-${svc}:${IMAGE_TAG}"
                            REMOTE_LATEST="${DOCKERHUB_NAMESPACE}/ecommerce-${svc}:latest"
                            docker tag "$LOCAL_IMG" "$REMOTE_TAG"
                            docker tag "$LOCAL_IMG" "$REMOTE_LATEST"

                            echo "Pushing ${REMOTE_TAG} and ${REMOTE_LATEST}..."
                            for attempt in 1 2 3; do
                                if docker push --quiet "$REMOTE_TAG" && docker push --quiet "$REMOTE_LATEST"; then
                                    break
                                fi
                                if [ "$attempt" -eq 3 ]; then
                                    echo "Failed to push ecommerce-${svc} after 3 attempts"
                                    exit 1
                                fi
                                echo "Retrying push for ecommerce-${svc} in 5s (attempt ${attempt}/3)..."
                                sleep 5
                            done
                        done
                    '''
                }
            }
        }

        // =====================================================================
        // AWS CONTINUOUS DELIVERY (CD) — APPROPRIATE PLACEMENT
        // Runs only after gateway tests, compose build, health checks,
        // compose-smoke.mjs, and image publishing have all succeeded.
        // =====================================================================
        //
        // --- Example 1: Push images to Amazon ECR ---
        // stage('Push images to AWS ECR') {
        //     when {
        //         expression { env.BRANCH_NAME == null || env.BRANCH_NAME == 'master' || env.BRANCH_NAME == 'main' }
        //     }
        //     steps {
        //         withAWS(credentials: 'aws-cd-credentials', region: "${AWS_REGION}") {
        //             sh '''
        //                 set -eu
        //                 aws ecr get-login-password --region "${AWS_REGION}" | \
        //                     docker login --username AWS --password-stdin "${ECR_REGISTRY}"
        //
        //                 for svc in identity gateway commerce web; do
        //                     SRC="${COMPOSE_PROJECT_NAME}-${svc}:latest"
        //                     DST="${ECR_REGISTRY}/ecommerce-${svc}:${IMAGE_TAG}"
        //                     DST_LATEST="${ECR_REGISTRY}/ecommerce-${svc}:latest"
        //                     docker tag "$SRC" "$DST"
        //                     docker tag "$SRC" "$DST_LATEST"
        //                     docker push --quiet "$DST"
        //                     docker push --quiet "$DST_LATEST"
        //                 done
        //             '''
        //         }
        //     }
        // }
        //
        // --- Example 2A: Deploy to AWS ECS (Fargate) ---
        // stage('Deploy to AWS ECS (CD)') {
        //     when {
        //         expression { env.BRANCH_NAME == null || env.BRANCH_NAME == 'master' || env.BRANCH_NAME == 'main' }
        //     }
        //     steps {
        //         withAWS(credentials: 'aws-cd-credentials', region: "${AWS_REGION}") {
        //             sh '''
        //                 set -eu
        //                 # 1. Push Prisma schemas for identity and commerce before rolling services
        //                 aws ecs run-task \
        //                     --cluster "${ECS_CLUSTER}" \
        //                     --task-definition ecommerce-identity-db-setup \
        //                     --launch-type FARGATE \
        //                     --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxx],securityGroups=[sg-xxxx],assignPublicIp=DISABLED}"
        //                 aws ecs run-task \
        //                     --cluster "${ECS_CLUSTER}" \
        //                     --task-definition ecommerce-commerce-db-setup \
        //                     --launch-type FARGATE \
        //                     --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxx],securityGroups=[sg-xxxx],assignPublicIp=DISABLED}"
        //
        //                 # 2. Roll ECS services (worker runs the commerce image with `node scripts/worker.mjs`)
        //                 for svc in ecommerce-identity ecommerce-gateway ecommerce-commerce ecommerce-web ecommerce-worker; do
        //                     aws ecs update-service \
        //                         --cluster "${ECS_CLUSTER}" \
        //                         --service "$svc" \
        //                         --force-new-deployment
        //                 done
        //
        //                 # 3. Wait for stabilization and verify public ALB health
        //                 aws ecs wait services-stable \
        //                     --cluster "${ECS_CLUSTER}" \
        //                     --services ecommerce-identity ecommerce-gateway ecommerce-commerce ecommerce-web
        //                 curl --fail --retry 10 --retry-delay 5 "https://shop.example.com/health"
        //             '''
        //         }
        //     }
        // }
        //
        // --- Example 2B: Deploy to AWS EC2 via SSM (Docker Compose) ---
        // stage('Deploy to AWS EC2 via SSM (CD)') {
        //     steps {
        //         withAWS(credentials: 'aws-cd-credentials', region: "${AWS_REGION}") {
        //             sh '''
        //                 set -eu
        //                 aws ssm send-command \
        //                     --document-name "AWS-RunShellScript" \
        //                     --targets "Key=tag:App,Values=ecommerce-prod" \
        //                     --parameters commands="cd /opt/ecommerce && docker compose pull && docker compose up -d --remove-orphans"
        //             '''
        //         }
        //     }
        // }
        //
        // --- Example 2C: Deploy to AWS EKS (Kubernetes / Helm) ---
        // stage('Deploy to AWS EKS (CD)') {
        //     steps {
        //         withAWS(credentials: 'aws-cd-credentials', region: "${AWS_REGION}") {
        //             sh '''
        //                 set -eu
        //                 aws eks update-kubeconfig --region "${AWS_REGION}" --name ecommerce-eks-cluster
        //                 for svc in identity gateway commerce web; do
        //                     kubectl -n ecommerce set image "deployment/ecommerce-${svc}" "${svc}=${ECR_REGISTRY}/ecommerce-${svc}:${IMAGE_TAG}"
        //                 done
        //                 kubectl -n ecommerce set image deployment/ecommerce-worker "worker=${ECR_REGISTRY}/ecommerce-commerce:${IMAGE_TAG}"
        //                 kubectl -n ecommerce rollout status deployment/ecommerce-web --timeout=180s
        //             '''
        //         }
        //     }
        // }
    }

    post {
        failure {
            sh 'docker compose logs --no-color --tail=200 || true'
        }
        always {
            sh '''
                docker compose down --volumes --remove-orphans || true
                rm -f .env || true
                for svc in identity gateway commerce web; do
                    docker rmi "${DOCKERHUB_NAMESPACE}/ecommerce-${svc}:${IMAGE_TAG}" "${DOCKERHUB_NAMESPACE}/ecommerce-${svc}:latest" 2>/dev/null || true
                done
                docker logout || true
                docker image prune -f --filter "until=24h" || true
            '''
        }
    }
}
