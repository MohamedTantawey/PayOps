pipeline{
    agent {
        label 'docker'
    }
    environment {
        IMAGE="abdarlhman1/payops"
        TAG = "${env.BUILD_NUMBER}"
        AWS_REGION       = 'eu-north-1'
        AWS_ACCOUNT_ID   = '950219439587'
        ECR_REPO_NAME    = 'payops'
        ECS_CLUSTER_NAME = 'payops-cluster'
        ECS_SERVICE_NAME = 'payops-service'
        ECR_REGISTRY     = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        FULL_ECR_IMAGE   = "${ECR_REGISTRY}/${ECR_REPO_NAME}"
        
    }
    stages {
        stage('Build environment setup') {
            steps {
            sh '''
                set -eux
                docker version
                docker compose version
                aws --version
                curl --version
                command -v timeout

                test -f .env || cp .env.example .env
            '''
            }
        }

        stage('Build docker image') {
            steps {
                script {
                    sh "docker build -t ${env.IMAGE}:${env.TAG} -f Dockerfile ."
                }
            }
        }
        stage('SonarQube analysis') {
            steps {
                script {
                    def scannerHome = tool 'SonarScanner'
                    withSonarQubeEnv('SonarQube-server') {
                        sh "${scannerHome}/bin/sonar-scanner"
                        }
                    }
                }
            }
           
        stage('Quality gate') {
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }   
        stage('Run test') {
            steps {
                script {
                    env.DOCKER_BUILDKIT = 1
                    sh 'docker run --rm -e CI=true "$IMAGE:$TAG" npm test'
                }
            }
        }

        stage('Smoke test') {
            steps {
                sh '''
                    set -e

                    IMAGE="$IMAGE" TAG="$TAG" docker compose up \
                        -d --no-build --wait --wait-timeout 60

                    IMAGE="$IMAGE" TAG="$TAG" docker compose exec \
                        -T app wget -qO- http://localhost:3000/health
                '''
            }
        }
        
        stage('Generate deployment package') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    zip -r deploy.zip . \
                    -x ".git/*" "node_modules/*" ".env" "deploy.zip"
                '''
            }
        }

        stage('Push Image to Amazon ECR') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-credentials-id',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -e

                        aws ecr get-login-password --region "$AWS_REGION" |
                            docker login --username AWS --password-stdin "$ECR_REGISTRY"

                        docker tag "$IMAGE:$TAG" "$FULL_ECR_IMAGE:$TAG"
                        docker push "$FULL_ECR_IMAGE:$TAG"

                        docker logout "$ECR_REGISTRY"
                    '''
                }
            }
        }
        stage('Deploy to ECS Fargate') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aws-credentials-id',
                        usernameVariable: 'AWS_ACCESS_KEY_ID',
                        passwordVariable: 'AWS_SECRET_ACCESS_KEY'
                    )
                ]) {
                    sh '''
                        set -e

                        aws ecs update-service \
                            --cluster "$ECS_CLUSTER_NAME" \
                            --service "$ECS_SERVICE_NAME" \
                            --force-new-deployment \
                            --region "$AWS_REGION"

                        aws ecs wait services-stable \
                            --cluster "$ECS_CLUSTER_NAME" \
                            --services "$ECS_SERVICE_NAME" \
                            --region "$AWS_REGION"
                    '''
                }
            }
        }
    }
    
    post {
        always {
            sh 'docker compose down -v || true'
            }
        }
}