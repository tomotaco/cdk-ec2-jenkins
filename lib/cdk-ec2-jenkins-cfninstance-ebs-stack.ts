import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as path from 'path';

import { Construct } from 'constructs';

export const format = (str: string, ...args: unknown[]): string => {
  for (const [i, arg] of args.entries()) {
    const regExp = new RegExp(`\\{${i}}`, 'g')
    str = str.replace(regExp, arg as string)
  }
  return str
}

export class CdkEc2JenkinsCfnInstanceEbsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "VPC", {
      isDefault: true
    });

    const incomingCIDR = "[YourGlobalIPAddress]/32";
    const securityGroupEC2 = new ec2.SecurityGroup(this, "SecurityGtoup", {
      vpc,
      description: "Allow SSH, Jenkins and all TCP access from same security group",
      allowAllOutbound: true
    });
    securityGroupEC2.addIngressRule(
      ec2.Peer.ipv4(incomingCIDR),
      ec2.Port.tcp(22),
      "Allow SSH Ingress"
    );
    securityGroupEC2.addIngressRule(
      ec2.Peer.ipv4(incomingCIDR),
      ec2.Port.tcp(8080),
      "Allow Jenkins Ingress"
    );
    securityGroupEC2.addIngressRule(
      securityGroupEC2,
      ec2.Port.allTcp(),
      "Allow Self-referencing Ingress"
    );

    const role = new iam.Role(this, "ec2Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    const cfnInstanceProfile = new iam.CfnInstanceProfile(this, "InstanceProfile", {
      roles: [role.roleName]
    });

    // UserData for EC2
    const script = fs.readFileSync(
      path.join(__dirname, '..', 'script', 'user_data_ebs.sh'),
      {encoding: 'utf8'})

    const ebsMountPoint = "/mnt/jenkins_persistent"
    const scriptFormatted = format(script, ebsMountPoint)

    const userData = ec2.UserData.forLinux({shebang: "#!/bin/bash"})
    userData.addCommands(...scriptFormatted.split('\n'))

    // EC2 Instance
    const machineImage = ec2.MachineImage.fromSsmParameter("/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-6.1-x86_64");

    const jenkinsPersistentSnapshotId = scope.node.tryGetContext("jenkinsPersistentSnapshotId") as string
    if (jenkinsPersistentSnapshotId == undefined) {
      console.log("jenkinsPersistentSnapshotId is undefined. JenkinsPersistent will be initialized.")
    }

    const cfnInstance = new ec2.CfnInstance(this, "CfnInstance", {
      tags: [{key: "Name", value: "[YourJenkinsInstanceName]"}],
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.SMALL
      ).toString(),
      imageId: machineImage.getImage(this).imageId,
      keyName: "[YourKeyPairName]",
      iamInstanceProfile: cfnInstanceProfile.ref,
      networkInterfaces: [{
        deviceIndex: '0',
        associatePublicIpAddress: true,
        deleteOnTermination: true,
        subnetId: vpc.publicSubnets[0].subnetId,
        groupSet: [securityGroupEC2.securityGroupId],
      }],
      blockDeviceMappings: [{
        deviceName: "/dev/xvda",
        ebs: {
          volumeSize: 64,
          volumeType: "gp2"
        }
      },
      {
        deviceName: "/dev/xvdb",
        ebs: {
          deleteOnTermination: false,
          snapshotId: jenkinsPersistentSnapshotId,
          volumeSize: 64,
          volumeType: "gp2"
        }
      }],
      userData: cdk.Fn.base64(userData.render())
    });

    new cdk.CfnOutput(this, "PublicIp", {value: cfnInstance.attrPublicIp})
    new cdk.CfnOutput(this, "PrivateIp", {value: cfnInstance.attrPrivateIp})
  }
}
