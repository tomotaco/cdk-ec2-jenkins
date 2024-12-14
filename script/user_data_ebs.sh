#!/bin/bash

sudo dnf -y update

# Install Amazon System Manager
sudo dnf install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm

# Install Amazon Corette 21 (OpenJDK)
sudo dnf -y install java-21-amazon-corretto-headless

# Add jenkins repository
sudo dnf config-manager --add-repo=https://pkg.jenkins.io/redhat-stable/jenkins.repo
sudo rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key
sudo cat /etc/yum.repos.d/jenkins.repo | sed s/http/https/g > /tmp/jenkins.repo
sudo mv -f /tmp/jenkins.repo /etc/yum.repos.d/jenkins.repo

# Add redis repository
sudo cat <<-__EOS__ > /etc/yum.repos.d/redis.repo
[Redis]
name=Redis
baseurl=http://packages.redis.io/rpm/rhel9
enabled=1
gpgcheck=1
__EOS__
curl -fsSL https://packages.redis.io/gpg > /tmp/redis.key
sudo rpm --import /tmp/redis.key

# Create mount directory
sudo mkdir -p {0}

# If JenkinsPersistent filesystem is not formatted, do mkfs
sudo file -s -L /dev/xvdb | grep UUID > /tmp/prev-xvdb-uuid.txt
if [ "$?" == "1" ]; then
    echo "Doing mkfs"
    sudo mkfs -t ext4 /dev/xvdb
else
    echo "Skip mkfs"
fi
sleep 10

# Update fstab
sudo file -s -L /dev/xvdb | sed -r "s/.*UUID=([a-z0-9\-]+).*/\1/g" > /tmp/xvdb-uuid.txt
sudo echo UUID=`cat /tmp/xvdb-uuid.txt` {0} ext4 defaults 1 1 >> /etc/fstab

# Mount JenkinsPersistent filesystem
sudo mkdir -p {0}
sudo mount /dev/xvdb {0}

# Make symlink to JENKINS_HOME
sudo mkdir -p {0}/jenkins_home 
sudo ln -s {0}/jenkins_home /var/lib/jenkins

# Get Public IP address
TOKEN=`curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"`
PUBLIC_IP=`http://169.254.169.254/latest/meta-data/public-ipv4`

# Replace Jenkins URL
JENKINS_CONF_XML=/var/lib/jenkins/jenkins.model.JenkinsLocationConfiguration.xml
sudo cat $JENKINS_CONF_XML | sed -re "s|(https?)://([^/]+)/|\1://$PUBLIC_IP:8080/|" > /tmp/tmp.xml
sudo cp /tmp/tmp.xml $JENKINS_CONF_XML

# Install Jenkins
sudo dnf -y install jenkins

# Enable Jenkins as a service
sudo systemctl enable jenkins
sudo systemctl start jenkins

# Make symlink to Redis data dir
sudo mkdir -p {0}/redis-stack-data 
sudo ln -s {0}/redis-stack-data /var/lib/redis-stack

#Install Redis stack server
sudo dnf -y install redis-stack-server

# Add save interval to redis-stack.conf 
echo save 15 1 >> /etc/redis-stack.conf

# Enable Redis stack server as a service
sudo systemctl enable redis-stack-server
sudo systemctl start redis-stack-server

# Create swap file
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
sudo echo /swapfile swap swap defaults 0 0 >> /etc/fstab

# Disable tmpfs for /tmp
sudo systemctl mask tmp.mount

# Required Reboot
sudo reboot