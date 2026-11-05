pipeline{
    agent {
        label 'docker'
    }
    stages {
        stage('Build docker image') {
            steps {
                script {
                    sh 'docker build -t abdarlhman1/jenkis-payops -f Dockerfile .'
                }
            }
        }
        stage('Run test')
            steps{
                script {
                    env.DOCKER_BUILDKIT = 1
                    sh 'docker run -e CI=true abdarlhman1/jenkis-payops npm run test'
                }
            }
    
    }
}