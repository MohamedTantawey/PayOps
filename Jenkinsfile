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
        COMPOSE_PROJECT_NAME = "payops-${BUILD_NUMBER}"

        DB_HOST = '127.0.0.1'
        DB_PORT = '5433'
        DB_NAME = 'payops'
        DB_USER = 'payops_admin'
        DB_PASSWORD = 'change_me_in_secrets_manager'
        REDIS_URL = 'redis://127.0.0.1:6379'
        PAYOPS_BACKEND_HOST_PORT = '3002'
        WORKER_HOST_PORT = '3004'
        BACKEND_URL = 'http://127.0.0.1:3002'
    }

    stages {
        stage('Build environment setup') {
            steps {
                sh '''
                    set -eu
                    docker version
                    docker compose version
                    node --version
                    yarn --version
                    curl --version
                    git --version
                    command -v timeout
                    test -f package.json
                    test -f yarn.lock
                '''
            }
        }

        stage('Validate Compose') {
            steps {
                sh 'docker compose config --quiet'
            }
        }

        stage('Install dependencies') {
            steps {
                sh 'yarn install --frozen-lockfile'
            }
        }

        stage('Unit tests') {
            steps {
                sh 'yarn test:unit'
            }
        }

        stage('SonarQube Analysis') {
            steps {
                script {
                    def scannerHome = tool 'SonarQubeScanner'
                    withSonarQubeEnv('SonarQube') {
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

        stage('Build all the images') {
            steps {
                sh 'docker compose build'
            }
        }

        stage('Start test stack') {
            steps {
                sh 'docker compose up -d --wait --wait-timeout 120'
            }
        }

        stage('Integration tests') {
            steps {
                sh 'yarn test:integration'
            }
        }

        stage('Smoke tests') {
            steps {
                sh '''
                    set -eu

                    curl --fail --retry 30 --retry-connrefused \
                        --retry-delay 2 --max-time 5 \
                        http://127.0.0.1:3002/status

                    curl --fail --retry 30 --retry-connrefused \
                        --retry-delay 2 --max-time 5 \
                        http://127.0.0.1:3004/health

                    curl --fail --retry 30 --retry-connrefused \
                        --retry-delay 2 --max-time 5 \
                        http://127.0.0.1:8080/
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

                        for svc in backend frontend worker mock-psp; do
                            echo "Pushing abdalrhman1/payops-${svc}:${BUILD_NUMBER}..."
                            for attempt in 1 2 3; do
                                if docker push --quiet "abdalrhman1/payops-${svc}:${BUILD_NUMBER}"; then
                                    break
                                fi
                                if [ "$attempt" -eq 3 ]; then
                                    echo "Failed to push payops-${svc} after 3 attempts"
                                    exit 1
                                fi
                                echo "Retrying push for payops-${svc} in 5s (attempt ${attempt}/3)..."
                                sleep 5
                            done
                        done
                    '''
                }
            }
        }

    post {
        failure {
            sh 'docker compose logs --no-color --tail=200 || true'
        }
        always {
            sh 'docker compose down --volumes --remove-orphans || true'
            sh 'docker image prune -f --filter "until=24h" || true'
        }
    }
}