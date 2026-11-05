pipeline{
    agent {
        label 'docker'
    }
    environment {
        IMAGE="abdarlhman1/payops"
        TAG = "${env.BUILD_NUMBER}"
    }
    stages {
        stage('Build environment setup') {
            steps {
            sh '''
                set -eux
                docker version
                docker compose version
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
                script {
                    sh '''
                        docker compose up -d --no-build --wait --wait-timeout 60
                        docker compose exec -T app wget -qO- http://localhost:3000/health
                    '''
                }
            }
        }
        stage('Push Docker image') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub',
                        usernameVariable: 'DOCKER_USERNAME',
                        passwordVariable: 'DOCKER_PASSWORD'
                    )
                ]) {
                    sh '''
                        echo "$DOCKER_PASSWORD" | docker login \
                            --username "$DOCKER_USERNAME" \
                            --password-stdin

                        docker push "$IMAGE:$TAG"

                        docker logout
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