pipeline{
    agent any
    options {
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }   
    environment {
        DOCKER_BUILDKIT = 1
        IMAGE_TAG = "${BUILD_NUMBER}"
        COMPOSE_PROJECT_NAME = "payops-${BUILD_NUMBER}"   
    }
    stages {
        stage('Build enviroment setup'){
            steps {
                sh '''
                    set -eu
                    docker version
                    docker compose version
                    yarn --version
                    test -f yarn.lock
                    aws --version
                    curl --version
                    git --version
                    command -v timeout
                '''
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
                script {
                    // Build all the services using Docker
                    sh 'docker compose build'
                }
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
                        http://127.0.0.1:3000/status

                    curl --fail --retry 30 --retry-connrefused \
                        --retry-delay 2 --max-time 5 \
                        http://127.0.0.1:3001/health

                    curl --fail --retry 30 --retry-connrefused \
                        --retry-delay 2 --max-time 5 \
                        http://127.0.0.1:8080/
                '''
            }
        }
        stage('Push images to Docker Hub') {
            when { branch 'main' }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-token',
                    usernameVariable: 'DH_USER',
                    passwordVariable: 'DH_TOKEN'
                )]) {
                    sh '''
                        set -eu
                        set +x

                        trap 'docker logout >/dev/null 2>&1 || true' EXIT

                        echo "$DH_TOKEN" | docker login \
                            --username "$DH_USER" \
                            --password-stdin

                        docker compose push backend worker frontend mock-psp
                    '''
                }
            }
        }

    }
    post {
        failure {
            sh 'docker compose logs --no-color --tail=200 || true'
        }
        always {
            sh 'docker compose down --volumes --remove-orphans || true'
            sh 'docker image prune -f || true'
        }
    }
}